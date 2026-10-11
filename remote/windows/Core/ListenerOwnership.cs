using System.ComponentModel;
using System.Runtime.InteropServices;

namespace DshRemote.Core;

// Read OS listener ownership instead of treating a successful connection to somebody else's port as readiness.
internal static class ListenerOwnership
{
    public static bool IsOwnedBy(int processId, int port)
    {
        if (OperatingSystem.IsWindows()) return WindowsOwner(processId, port);
        if (OperatingSystem.IsLinux()) return LinuxOwner(processId, port);
        throw new PlatformNotSupportedException("SSH listener ownership is supported on Windows and Linux.");
    }

    private static bool LinuxOwner(int processId, int port)
    {
        try
        {
            var sockets = new HashSet<string>(StringComparer.Ordinal);
            foreach (var path in Directory.EnumerateFiles($"/proc/{processId}/fd"))
            {
                var target = new FileInfo(path).LinkTarget;
                if (target is not null && target.StartsWith("socket:[", StringComparison.Ordinal)) sockets.Add(target);
            }
            var endpoint = $"0100007F:{port:X4}";
            foreach (var line in File.ReadLines($"/proc/{processId}/net/tcp").Skip(1))
            {
                var columns = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                if (columns.Length > 9 && columns[1] == endpoint && columns[3] == "0A" && sockets.Contains($"socket:[{columns[9]}]")) return true;
            }
            return false;
        }
        catch (IOException) { return false; } // A process or its socket can exit while /proc is being read.
    }

    private static bool WindowsOwner(int processId, int port)
    {
        var length = 0;
        var result = GetExtendedTcpTable(IntPtr.Zero, ref length, false, 2, 3, 0);
        while (result == 122)
        {
            var buffer = Marshal.AllocHGlobal(length);
            try
            {
                result = GetExtendedTcpTable(buffer, ref length, false, 2, 3, 0);
                if (result == 122) continue;
                if (result != 0) throw new Win32Exception((int)result, "Cannot inspect SSH listener ownership.");
                var count = Marshal.ReadInt32(buffer);
                for (var index = 0; index < count; index++)
                {
                    var row = 4 + index * 24;
                    var address = Marshal.ReadInt32(buffer, row + 4);
                    var encodedPort = Marshal.ReadInt32(buffer, row + 8);
                    var owner = Marshal.ReadInt32(buffer, row + 20);
                    var hostPort = ((encodedPort & 255) << 8) | ((encodedPort >> 8) & 255);
                    if (owner == processId && address == 0x0100007F && hostPort == port) return true;
                }
                return false;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        if (result != 0) throw new Win32Exception((int)result, "Cannot inspect SSH listener ownership.");
        return false;
    }

    [DllImport("iphlpapi.dll", ExactSpelling = true)]
    private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, [MarshalAs(UnmanagedType.Bool)] bool sort,
        int addressFamily, int tableClass, uint reserved);
}

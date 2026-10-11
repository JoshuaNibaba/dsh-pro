using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace DshRemote.Core;

// Completion includes both pipe readers. Disposal is idempotent and joins the same completion task.
internal sealed class OwnedProcess : IAsyncDisposable
{
    internal const int OutputLimit = 1024 * 1024;
    private readonly Process process;
    private readonly BoundedText stdout = new(OutputLimit);
    private readonly BoundedText stderr = new(32768);
    private readonly object gate = new();
    private Task? disposal;
    public Task<int> Completion { get; }
    public int ProcessId => process.Id;
    public string StandardOutput => stdout.Text;
    public string StandardError => stderr.Text;

    public OwnedProcess(ProcessStartInfo startInfo, Action<string>? errorLine = null)
    {
        process = new Process { StartInfo = startInfo };
        try
        {
            process.Start();
        }
        catch (Exception error) when (error is Win32Exception or InvalidOperationException)
        {
            process.Dispose();
            throw new InvalidOperationException($"Cannot start SSH at '{startInfo.FileName}'. Install the OpenSSH Client Windows optional feature, or /usr/bin/ssh on Linux. {error.Message}", error);
        }
        var output = DrainAsync(process.StandardOutput, stdout, null);
        var errors = DrainAsync(process.StandardError, stderr, errorLine);
        Completion = JoinAsync(output, errors);
        process.StandardInput.Close();
    }

    private async Task<int> JoinAsync(Task output, Task errors)
    {
        await process.WaitForExitAsync().ConfigureAwait(false);
        await Task.WhenAll(output, errors).ConfigureAwait(false);
        return process.ExitCode;
    }

    private static async Task DrainAsync(StreamReader reader, BoundedText target, Action<string>? onLine)
    {
        var buffer = new char[4096];
        var pending = new StringBuilder();
        int count;
        while ((count = await reader.ReadAsync(buffer.AsMemory()).ConfigureAwait(false)) > 0)
        {
            target.Append(buffer, count);
            if (onLine is null) continue;
            for (var i = 0; i < count; i++)
            {
                if (buffer[i] == '\n')
                {
                    onLine(pending.ToString().TrimEnd('\r'));
                    pending.Clear();
                }
                else if (pending.Length < 8192) pending.Append(buffer[i]);
            }
        }
        if (pending.Length > 0) onLine?.Invoke(pending.ToString());
    }

    public ValueTask DisposeAsync()
    {
        lock (gate) return new ValueTask(disposal ??= StopAsync());
    }

    private async Task StopAsync()
    {
        try
        {
            if (!process.HasExited)
            {
                try { process.Kill(entireProcessTree: true); }
                catch (InvalidOperationException) { /* The child exited between HasExited and Kill. */ }
            }
            await Completion.ConfigureAwait(false);
        }
        finally { process.Dispose(); }
    }

    private sealed class BoundedText(int limit)
    {
        private readonly StringBuilder text = new();
        private readonly object gate = new();
        private bool truncated;
        public string Text { get { lock (gate) return (truncated ? "[earlier output truncated]\n" : "") + text; } }
        public void Append(char[] buffer, int count)
        {
            lock (gate)
            {
                text.Append(buffer, 0, count);
                if (text.Length <= limit) return;
                text.Remove(0, text.Length - limit);
                truncated = true;
            }
        }
    }
}

internal static class SshProcess
{
    public static ProcessStartInfo Create(RemoteSettings settings, string? executablePath)
    {
        settings.Validate();
        if (settings.SshHost.Length == 0) throw new ArgumentException("An SSH host is required.", nameof(settings));
        var executable = executablePath ?? (OperatingSystem.IsWindows()
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "OpenSSH", "ssh.exe")
            : "/usr/bin/ssh");
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        foreach (var key in start.Environment.Keys.ToArray())
            if (new[] { "KEY", "SECRET", "TOKEN", "PASSWORD" }.Any(part => key.Contains(part, StringComparison.OrdinalIgnoreCase)))
                start.Environment.Remove(key);
        start.Environment["LC_ALL"] = "C";
        foreach (var option in new[] { "BatchMode=yes", "ConnectTimeout=10", "ServerAliveInterval=10", "ServerAliveCountMax=3", "StrictHostKeyChecking=accept-new", "ControlMaster=no", "ControlPath=none", "PermitLocalCommand=no", "RequestTTY=no" })
        {
            start.ArgumentList.Add("-o");
            start.ArgumentList.Add(option);
        }
        if (settings.SshPort > 0)
        {
            start.ArgumentList.Add("-p");
            start.ArgumentList.Add(settings.SshPort.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        return start;
    }

    public static TimeSpan TimeoutOrDefault(TimeSpan? timeout)
    {
        var value = timeout ?? TimeSpan.FromSeconds(30);
        if (value <= TimeSpan.Zero || value.TotalMilliseconds > uint.MaxValue - 1)
            throw new ArgumentOutOfRangeException(nameof(timeout));
        return value;
    }
}

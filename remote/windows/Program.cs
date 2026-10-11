using System.Reflection;
using DshRemote.Core;

namespace DshRemote;

internal static class Program
{
    internal static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DSHRemote");
    internal static string SettingsPath => Path.Combine(DataDirectory, "settings.json");
    internal static Version Version => Assembly.GetExecutingAssembly().GetName().Version ?? new Version(1, 0, 0);

    [STAThread]
    private static int Main(string[] args)
    {
        // The published executable can verify its native dependencies without creating a browser.
        if (args is ["--self-check"])
        {
            try
            {
                if (!OperatingSystem.IsWindowsVersionAtLeast(10)) return 1;
                _ = typeof(Microsoft.Web.WebView2.WinForms.WebView2).Assembly.GetName();
                if (NavigationPolicy.NormalizeWebUrl("https://example.com")?.Host != "example.com") return 1;
                var loader = System.Runtime.InteropServices.NativeLibrary.Load(Path.Combine(AppContext.BaseDirectory, "WebView2Loader.dll"));
                System.Runtime.InteropServices.NativeLibrary.Free(loader);
                return 0;
            }
            catch (Exception error)
            {
                System.Diagnostics.Trace.WriteLine(error);
                return 1;
            }
        }

        ApplicationConfiguration.Initialize();
        // One owner per Windows login session keeps the WebView profile and SSH port exclusive.
        using var instance = new Mutex(true, "Local\\DSHRemote.Windows", out var ownsInstance);
        if (!ownsInstance)
        {
            MessageBox.Show("DSH Remote 已在运行，请切换到已打开的窗口。", "DSH Remote");
            return 0;
        }
        try
        {
            Directory.CreateDirectory(DataDirectory);
            Application.Run(new MainForm());
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(Log.Redact(error.Message), "DSH Remote 无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally { instance.ReleaseMutex(); }
    }
}

internal static class Log
{
    private static readonly object Sync = new();
    internal static string FilePath => Path.Combine(Program.DataDirectory, "client.log");
    internal static string Redact(string message) => System.Text.RegularExpressions.Regex.Replace(
        message, @"(?i)(token=)[^\s&#""'<>]*", "$1<hidden>");

    internal static void Write(string message)
    {
        lock (Sync)
        {
            try
            {
                if (File.Exists(FilePath) && new FileInfo(FilePath).Length > 2 * 1024 * 1024)
                    File.WriteAllText(FilePath, "");
                File.AppendAllText(FilePath, $"{DateTimeOffset.Now:O} {Redact(message)}{Environment.NewLine}");
            }
            catch (IOException error) { System.Diagnostics.Trace.WriteLine(error); }
            catch (UnauthorizedAccessException error) { System.Diagnostics.Trace.WriteLine(error); }
        }
    }
}

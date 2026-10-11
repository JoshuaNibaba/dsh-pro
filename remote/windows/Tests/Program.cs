using System.Diagnostics;
using System.IO.Pipes;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;
using DshRemote.Core;

internal static class Program
{
    private static string AppHost => Path.Combine(AppContext.BaseDirectory, OperatingSystem.IsWindows() ? "DshRemote.Tests.exe" : "DshRemote.Tests");
    private static RemoteSettings SshSettings => new() { SshHost = "fixture.invalid" };

    public static async Task<int> Main(string[] args)
    {
        if (args.Contains("-o") || args.FirstOrDefault()?.StartsWith("--fixture", StringComparison.Ordinal) == true)
            return await FixtureAsync(args);
        try
        {
            TestNavigationAndSettings();
            Console.WriteLine("PASS URL origins, validation and settings persistence");
            TestCommands();
            Console.WriteLine("PASS quoted commands and local login tokens");
            await TestOutputAsync();
            Console.WriteLine("PASS concurrent bounded stdout/stderr and argument integrity");
            await TestCancellationAsync();
            Console.WriteLine("PASS cancellation joins child and descendant processes");
            await TestTimeoutAsync();
            Console.WriteLine("PASS command timeout joins the real child");
            await TestTunnelAsync();
            Console.WriteLine("PASS tunnel readiness, OS listener ownership, disposal, port refusal, cancellation and timeout");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException("Assertion failed: " + message);
    }

    private static T Throws<T>(Action action) where T : Exception
    {
        try { action(); }
        catch (T error) { return error; }
        throw new InvalidOperationException($"Expected {typeof(T).Name}.");
    }

    private static async Task<T> ThrowsAsync<T>(Func<Task> action) where T : Exception
    {
        try { await action(); }
        catch (T error) { return error; }
        throw new InvalidOperationException($"Expected {typeof(T).Name}.");
    }

    private static void TestNavigationAndSettings()
    {
        Check(NavigationPolicy.NormalizeWebUrl(" example.com ")?.AbsoluteUri == "https://example.com/", "HTTPS default and trailing slash");
        foreach (var bad in new[] { "", "javascript:alert(1)", "file:///tmp/a", "file:/tmp/a", "javascript:/alert", "https://user:pass@example.com/", "https://example.com:0", "https://example.com:65536", "https://exa mple.com", "http://example.com\\evil", "https://example.com/\nsecret" })
            Check(NavigationPolicy.NormalizeWebUrl(bad) is null, "reject URL " + bad);
        var origin = new Uri("https://EXAMPLE.com/path");
        Check(NavigationPolicy.SameOrigin(origin, new Uri("https://example.com:443/other")), "canonical host/default port");
        foreach (var foreign in new[] { "http://example.com", "https://example.com:444", "https://example.com.evil", "https://other.example.com" })
            Check(!NavigationPolicy.SameOrigin(origin, new Uri(foreign)), "reject foreign origin " + foreign);
        Check(!NavigationPolicy.SafeExternal(new Uri("mailto:a@example.com")), "reject external non-web scheme");
        Check(!NavigationPolicy.SafeExternal(new Uri("/relative", UriKind.Relative)), "reject relative external URL");
        Throws<ArgumentException>(() => new RemoteSettings().Validate());
        foreach (var host in new[] { "-oProxyCommand=evil", "user@-host", "a b", "a\nb", "a;id", "$(id)", "user@@host", "host/path", "-::1" })
            Throws<ArgumentException>(() => (SshSettings with { SshHost = host }).Validate());
        foreach (var user in new[] { "-user", "a b", "a@b", "a;id", "a\nb" })
            Throws<ArgumentException>(() => (SshSettings with { SshUser = user }).Validate());
        foreach (var host in new[] { "host-alias", "user@host", "127.0.0.1", "::1", "[::1]" })
            (SshSettings with { SshHost = host }).Validate();
        Check((SshSettings with { SshUser = "alice" }).SshDestination == "alice@fixture.invalid", "separate SSH user");
        Check((SshSettings with { SshHost = "bob@host", SshUser = "alice" }).SshDestination == "bob@host", "embedded SSH user");
        foreach (var port in new[] { -1, 65536 }) Throws<ArgumentException>(() => (SshSettings with { SshPort = port }).Validate());
        foreach (var port in new[] { -1, 0, 65536 })
        {
            Throws<ArgumentException>(() => (SshSettings with { LocalPort = port }).Validate());
            Throws<ArgumentException>(() => (SshSettings with { RemotePort = port }).Validate());
        }
        foreach (var service in new[] { "", "-bad", "dsh;id", "a b", "a'", "$(id)", "a\nb" })
            Throws<ArgumentException>(() => (SshSettings with { Service = service }).Validate());
        var root = Path.Combine(AppContext.BaseDirectory, "settings-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var path = Path.Combine(root, "settings.json");
            Check(SettingsStore.Load(path) == new RemoteSettings(), "missing settings mean first launch");
            var settings = SshSettings with { WebUrl = "https://example.com", SshUser = "alice", SshPort = 2222, PreferSsh = true, CheckUpdates = false };
            SettingsStore.Save(path, settings);
            Check(SettingsStore.Load(path) == settings, "settings round trip");
            var json = File.ReadAllText(path);
            Check(!json.Contains("password", StringComparison.OrdinalIgnoreCase) && !json.Contains("WebUri") && !json.Contains("SshDestination"), "only persisted preferences");
            SettingsStore.Save(path, settings with { LocalPort = 12345 });
            Check(SettingsStore.Load(path).LocalPort == 12345, "replace existing settings");
            File.WriteAllText(path, "{broken");
            Check(Throws<InvalidDataException>(() => SettingsStore.Load(path)).Message.Contains(path), "corruption reports path");
            File.WriteAllText(path, "{\"SshHost\":\"host\",\"Password\":\"secret\"}");
            Throws<InvalidDataException>(() => SettingsStore.Load(path));
            File.WriteAllText(path, "{\"SshHost\":null}");
            Throws<InvalidDataException>(() => SettingsStore.Load(path));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    private static void TestCommands()
    {
        foreach (var generate in new Func<string, string>[] { SshCommands.LoginUrl, SshCommands.Logs, SshCommands.Restart })
        {
            Check(generate("dsh-web@alice.service").Contains("'dsh-web@alice.service'"), "quoted service");
            Throws<ArgumentException>(() => generate("dsh-web; touch /tmp/pwned"));
        }
        var url = SshCommands.ParseLoginUrl("Welcome!\ndsh web: https://remote.example:443/evil/path?other=1&token=a%2Bb%26c#fragment\n", 18791);
        Check(url?.AbsoluteUri == "http://127.0.0.1:18791/?token=a%2Bb%26c", "token only, no remote host/path/fragment");
        Check(SshCommands.ParseLoginUrl("http://host/?token=\nhttps://host/?token=good", 1234)?.Query == "?token=good", "skip empty tokens");
        Check(SshCommands.ParseLoginUrl("https://user:pass@host/?token=secret", 1234) is null, "reject source userinfo");
        Check(SshCommands.ParseLoginUrl("https://host/?not-token=value", 1234) is null, "token required");
        Throws<ArgumentException>(() => SshCommands.ParseLoginUrl("https://host/?token=a", 0));
    }

    private static async Task TestOutputAsync()
    {
        var client = new SshClient(AppHost);
        var output = await client.RunAsync(SshSettings, "--fixture:flood");
        Check(output.Length < 1024 * 1024 + 100 && output.StartsWith("[earlier output truncated]"), "stdout is bounded");
        Check(output.EndsWith("STDOUT-END"), "stdout drained through EOF");
        var failure = await ThrowsAsync<InvalidOperationException>(() => client.RunAsync(SshSettings, "--fixture:fail"));
        Check(failure.Message.Contains("code 23") && failure.Message.EndsWith("STDERR-END") && failure.Message.Length < 33000, "stderr bound and exit diagnostics");
        const string payload = "literal ; $(touch nowhere) `echo no` \"quoted\"\nline";
        var echo = await client.RunAsync(SshSettings with { SshPort = 2222, SshUser = "alice" }, payload);
        var argv = JsonSerializer.Deserialize<string[]>(echo)!;
        Check(argv[^1] == payload && argv[^2] == "alice@fixture.invalid" && argv[^3] == "--", "one remote command argument, no local shell");
        foreach (var option in new[] { "BatchMode=yes", "StrictHostKeyChecking=accept-new", "ServerAliveInterval=10", "ControlPath=none" })
            Check(argv.Contains(option), "SSH option " + option);
        Check(argv.Contains("2222"), "SSH port argument");
        Check(await client.RunAsync(SshSettings, "--fixture:stdin") == "EOF", "stdin is closed");
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await ThrowsAsync<OperationCanceledException>(() => new SshClient("missing-executable").RunAsync(SshSettings, "unused", cancelled.Token));
        Check((await ThrowsAsync<InvalidOperationException>(() => new SshClient(Path.Combine(AppContext.BaseDirectory, "missing-ssh")).RunAsync(SshSettings, "unused"))).Message.Contains("OpenSSH"), "missing SSH installation diagnostic");
    }

    private static async Task TestCancellationAsync()
    {
        await using var handshake = new Handshake();
        using var cancellation = new CancellationTokenSource();
        var operation = new SshClient(AppHost).RunAsync(SshSettings, "--fixture:tree|" + handshake.Name, cancellation.Token);
        try
        {
            var ids = await handshake.ReceiveAsync();
            Check(ids.Length == 2 && ids.All(IsAlive), "both real processes running before cancellation");
            cancellation.Cancel();
            await ThrowsAsync<OperationCanceledException>(() => operation);
            Check(ids.All(id => !IsAlive(id)), "cancel returns after process tree exit");
        }
        finally
        {
            cancellation.Cancel();
            try { await operation; } catch (OperationCanceledException) { /* Expected cancellation also joins fixture cleanup on assertion failure. */ }
        }
    }

    private static async Task TestTimeoutAsync()
    {
        await using var handshake = new Handshake();
        using var cleanup = new CancellationTokenSource();
        var operation = new SshClient(AppHost, TimeSpan.FromSeconds(5)).RunAsync(SshSettings, "--fixture:wait|" + handshake.Name, cleanup.Token);
        try
        {
            var ids = await handshake.ReceiveAsync();
            Check(ids.All(IsAlive), "real child reached handshake before deadline");
            await ThrowsAsync<TimeoutException>(() => operation);
            Check(ids.All(id => !IsAlive(id)), "timeout returns after child exit");
        }
        finally
        {
            cleanup.Cancel();
            try { await operation; } catch (Exception error) when (error is OperationCanceledException or TimeoutException) { /* Both paths own and join the child. */ }
        }
    }

    private static async Task TestTunnelAsync()
    {
        await TestReadyTunnelAsync();
        using var occupied = new TcpListener(IPAddress.Loopback, 0);
        occupied.Start();
        var port = ((IPEndPoint)occupied.LocalEndpoint).Port;
        Check(ListenerOwnership.IsOwnedBy(Environment.ProcessId, port), "OS reports the test's own loopback listener");
        Check(!ListenerOwnership.IsOwnedBy(int.MaxValue, port), "a reachable port does not establish another PID's ownership");
        var settings = SshSettings with { LocalPort = port, SshHost = "bind-failure" };
        var error = await ThrowsAsync<InvalidOperationException>(() => SshTunnel.StartAsync(settings, executablePath: AppHost));
        Check(error.Message.Contains("Address already in use"), "binding an occupied port fails");
        using (var probe = new TcpClient()) await probe.ConnectAsync(IPAddress.Loopback, port);
        Check(occupied.Pending(), "existing listener is still owned by the test");
        using (var accepted = await occupied.AcceptTcpClientAsync()) { }

        var forged = await ThrowsAsync<InvalidOperationException>(() => SshTunnel.StartAsync(settings with { SshHost = "forged-ready" }, executablePath: AppHost));
        Check(forged.Message.Contains("did not own the listener"), "ready-looking logs cannot claim another process's listener");

        await using var handshake = new Handshake();
        using var cancellation = new CancellationTokenSource();
        var startup = SshTunnel.StartAsync(settings with { SshHost = handshake.Name, SshUser = "unauthenticated" }, cancellation.Token, AppHost);
        try
        {
            var ids = await handshake.ReceiveAsync();
            Check(!startup.IsCompleted, "an unrelated reachable port does not make an unauthenticated tunnel ready");
            cancellation.Cancel();
            await ThrowsAsync<OperationCanceledException>(() => startup);
            Check(ids.All(id => !IsAlive(id)), "cancelled startup joins SSH");
        }
        finally
        {
            cancellation.Cancel();
            try { await startup; } catch (OperationCanceledException) { /* Startup cancellation joins its process before returning. */ }
        }
        var timeout = await ThrowsAsync<TimeoutException>(() => SshTunnel.StartAsync(settings with { SshHost = "silent" }, executablePath: AppHost, startupTimeout: TimeSpan.FromMilliseconds(150)));
        Check(timeout.Message.Contains("did not become ready"), "startup deadline is a diagnostic timeout");
    }

    private static async Task TestReadyTunnelAsync()
    {
        // The public SSH API requires a fixed port. The fixture's bind is the atomic allocation;
        // only an actual address-in-use result selects a new candidate, never a free-port probe.
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var port = RandomNumberGenerator.GetInt32(32768, 61000);
            using var startupCancellation = new CancellationTokenSource();
            SshTunnel tunnel;
            try
            {
                tunnel = await SshTunnel.StartAsync(SshSettings with { SshHost = "ready-fixture", LocalPort = port }, startupCancellation.Token, AppHost);
            }
            catch (InvalidOperationException error) when (error.Message.Contains("fixture-bind-conflict", StringComparison.Ordinal))
            {
                continue;
            }
            await using (tunnel)
            {
                var pidLine = tunnel.LastError.Split('\n').Single(line => line.StartsWith("fixture-pid=", StringComparison.Ordinal));
                var pid = int.Parse(pidLine["fixture-pid=".Length..]);
                Check(IsAlive(pid) && ListenerOwnership.IsOwnedBy(pid, port), "ready tunnel owns the actual loopback listener");
                startupCancellation.Cancel();
                Check(!tunnel.Completion.IsCompleted, "startup token does not dispose a returned tunnel");
                await Task.WhenAll(tunnel.DisposeAsync().AsTask(), tunnel.DisposeAsync().AsTask());
                Check(tunnel.Completion.IsCompletedSuccessfully && !IsAlive(pid), "concurrent disposal joins one process and both readers");
                Check(tunnel.LastError.Contains("SSH exited with code"), "completed tunnel includes exit diagnostics");
                using var rebound = new TcpListener(IPAddress.Loopback, port);
                rebound.Start();
                Check(rebound.LocalEndpoint is IPEndPoint, "disposal releases the tunnel's listener");
            }
            return;
        }
        throw new InvalidOperationException("Fixture could not allocate a loopback port after 20 atomic bind attempts.");
    }

    private static bool IsAlive(int id)
    {
        try { using var process = Process.GetProcessById(id); return !process.HasExited; }
        catch (ArgumentException) { return false; }
    }

    private sealed class Handshake : IAsyncDisposable
    {
        public string Name { get; } = "dsh-fixture-" + Guid.NewGuid().ToString("N");
        private readonly NamedPipeServerStream pipe;
        public Handshake() => pipe = new NamedPipeServerStream(Name, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        public async Task<int[]> ReceiveAsync()
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            await pipe.WaitForConnectionAsync(deadline.Token);
            using var reader = new StreamReader(pipe, leaveOpen: true);
            var line = await reader.ReadLineAsync(deadline.Token) ?? throw new InvalidDataException("Fixture handshake ended without process ids.");
            return line.Split(',').Select(int.Parse).ToArray();
        }
        public ValueTask DisposeAsync() => pipe.DisposeAsync();
    }

    private static async Task NotifyAsync(string name, params int[] ids)
    {
        await using var pipe = new NamedPipeClientStream(".", name, PipeDirection.Out, PipeOptions.Asynchronous);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await pipe.ConnectAsync(deadline.Token);
        await using var writer = new StreamWriter(pipe) { AutoFlush = true };
        await writer.WriteLineAsync(string.Join(',', ids));
    }

    private static async Task<int> FixtureAsync(string[] args)
    {
        if (args.Contains("-N"))
        {
            var destination = args[^1].Split('@');
            var mode = destination[0];
            if (mode == "bind-failure")
            {
                var forward = args[Array.IndexOf(args, "-L") + 1].Split(':');
                try
                {
                    using var listener = new TcpListener(IPAddress.Loopback, int.Parse(forward[1]));
                    listener.Start();
                    return 99;
                }
                catch (SocketException) { await Console.Error.WriteAsync("Address already in use"); return 255; }
            }
            if (mode == "ready-fixture")
            {
                var port = int.Parse(args[Array.IndexOf(args, "-L") + 1].Split(':')[1]);
                using var listener = new TcpListener(IPAddress.Loopback, port);
                try { listener.Start(); }
                catch (SocketException error) when (error.SocketErrorCode == SocketError.AddressAlreadyInUse)
                {
                    await Console.Error.WriteLineAsync("fixture-bind-conflict");
                    return 255;
                }
                await Console.Error.WriteLineAsync($"fixture-pid={Environment.ProcessId}");
                await Console.Error.WriteLineAsync("Authenticated to fixture ([127.0.0.1]:22) using publickey.");
                await Console.Error.WriteLineAsync($"debug1: Local forwarding listening on 127.0.0.1 port {port}.");
                await Console.Error.WriteLineAsync("debug1: Entering interactive session.");
                await Task.Delay(Timeout.InfiniteTimeSpan);
                return 0;
            }
            if (mode == "forged-ready")
            {
                var port = args[Array.IndexOf(args, "-L") + 1].Split(':')[1];
                await Console.Error.WriteLineAsync("Authenticated to fixture ([127.0.0.1]:22) using publickey.");
                await Console.Error.WriteLineAsync($"debug1: Local forwarding listening on 127.0.0.1 port {port}.");
                await Console.Error.WriteLineAsync("debug1: Entering interactive session.");
            }
            if (mode == "unauthenticated") await NotifyAsync(destination[1], Environment.ProcessId);
            await Task.Delay(Timeout.InfiniteTimeSpan);
            return 0;
        }
        var parts = args[^1].Split('|');
        switch (parts[0])
        {
            case "--fixture:leaf":
                await Task.Delay(Timeout.InfiniteTimeSpan);
                return 0;
            case "--fixture:tree":
                using (var leaf = Process.Start(new ProcessStartInfo(AppHost) { UseShellExecute = false, ArgumentList = { "--fixture:leaf" } })!)
                {
                    await NotifyAsync(parts[1], Environment.ProcessId, leaf.Id);
                    await Task.Delay(Timeout.InfiniteTimeSpan);
                }
                return 0;
            case "--fixture:wait":
                await NotifyAsync(parts[1], Environment.ProcessId);
                await Console.Error.WriteLineAsync("fixture waiting");
                await Task.Delay(Timeout.InfiniteTimeSpan);
                return 0;
            case "--fixture:stdin":
                Console.Write(await Console.In.ReadToEndAsync() == "" ? "EOF" : "unexpected stdin");
                return 0;
            case "--fixture:flood":
            case "--fixture:fail":
                var chunk = new string('x', 8192);
                await Task.WhenAll(Task.Run(async () => { for (var i = 0; i < 256; i++) await Console.Out.WriteAsync(chunk); await Console.Out.WriteAsync("STDOUT-END"); }),
                    Task.Run(async () => { for (var i = 0; i < 256; i++) await Console.Error.WriteAsync(chunk); await Console.Error.WriteAsync("STDERR-END"); }));
                return parts[0] == "--fixture:fail" ? 23 : 0;
            default:
                Console.Write(JsonSerializer.Serialize(args));
                return 0;
        }
    }
}

using System.Net;
using System.Net.Sockets;

namespace DshRemote.Core;

/// <summary>Owns one SSH forward on Windows or Linux. Completion includes exit and both drained output streams; dispose always joins it.</summary>
public sealed class SshTunnel : IAsyncDisposable
{
    private readonly OwnedProcess process;
    private SshTunnel(OwnedProcess process) => this.process = process;
    public Task<int> Completion => process.Completion;
    public string LastError => Completion.IsCompletedSuccessfully
        ? $"{process.StandardError}\nSSH exited with code {Completion.Result}.".Trim()
        : process.StandardError;

    /// <summary>Waits for this SSH process to authenticate, own the OS loopback listener and accept a connection. The token controls startup only; the returned tunnel is owned until disposal. Failure kills and joins the process before throwing.</summary>
    /// <param name="settings">Validated SSH destination and fixed loopback ports.</param>
    /// <param name="cancellationToken">Cancels startup and joins the child before throwing.</param>
    /// <param name="executablePath">Optional SSH executable override for fixture processes.</param>
    /// <param name="startupTimeout">Defaults to 30 seconds; timeout errors include bounded SSH diagnostics.</param>
    public static async Task<SshTunnel> StartAsync(RemoteSettings settings, CancellationToken cancellationToken = default,
        string? executablePath = null, TimeSpan? startupTimeout = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var timeout = SshProcess.TimeoutOrDefault(startupTimeout);
        var start = SshProcess.Create(settings, executablePath);
        foreach (var argument in new[] { "-v", "-N", "-o", "ExitOnForwardFailure=yes", "-L", $"127.0.0.1:{settings.LocalPort}:127.0.0.1:{settings.RemotePort}", "--", settings.SshDestination })
            start.ArgumentList.Add(argument);
        var authenticated = false;
        var listening = false;
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        // OpenSSH emits the session marker after forwarding setup. ExitOnForwardFailure aborts before it on bind failure.
        void Observe(string line)
        {
            if (line.StartsWith("Authenticated to ", StringComparison.Ordinal)) authenticated = true;
            if (line == $"debug1: Local forwarding listening on 127.0.0.1 port {settings.LocalPort}.") listening = true;
            if (authenticated && listening && line == "debug1: Entering interactive session.") ready.TrySetResult();
        }
        using var deadline = new CancellationTokenSource(timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        var child = new OwnedProcess(start, Observe);
        var tunnel = new SshTunnel(child);
        try
        {
            var first = await Task.WhenAny(ready.Task, child.Completion).WaitAsync(linked.Token).ConfigureAwait(false);
            if (first == child.Completion)
                throw new InvalidOperationException($"SSH tunnel exited with code {await child.Completion.ConfigureAwait(false)} before it became ready. {child.StandardError}".Trim());
            if (!ListenerOwnership.IsOwnedBy(child.ProcessId, settings.LocalPort))
                throw new InvalidOperationException($"SSH did not own the listener on 127.0.0.1:{settings.LocalPort}. {child.StandardError}".Trim());
            using var probe = new TcpClient(AddressFamily.InterNetwork);
            await probe.ConnectAsync(IPAddress.Loopback, settings.LocalPort, linked.Token).ConfigureAwait(false);
            linked.Token.ThrowIfCancellationRequested();
            if (child.Completion.IsCompleted)
                throw new InvalidOperationException($"SSH tunnel exited during startup. {child.StandardError}".Trim());
            return tunnel;
        }
        catch (OperationCanceledException)
        {
            await tunnel.DisposeAsync().ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            throw new TimeoutException($"SSH tunnel did not become ready within {timeout.TotalSeconds:g} seconds. {child.StandardError}".Trim());
        }
        catch
        {
            await tunnel.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    public ValueTask DisposeAsync() => process.DisposeAsync();
}

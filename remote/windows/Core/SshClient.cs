namespace DshRemote.Core;

/// <summary>Runs key/agent-only OpenSSH commands with bounded output and joined cancellation.</summary>
public sealed class SshClient
{
    private readonly string? executablePath;
    private readonly TimeSpan timeout;

    /// <param name="executablePath">Optional SSH executable override, including a test fixture apphost.</param>
    /// <param name="timeout">Whole command deadline; defaults to 30 seconds.</param>
    public SshClient(string? executablePath = null, TimeSpan? timeout = null)
    {
        this.executablePath = executablePath;
        this.timeout = SshProcess.TimeoutOrDefault(timeout);
    }

    /// <summary>Returns at most the last 1 Mi characters of stdout plus a truncation marker. Failure includes bounded stderr; cancellation and timeout return only after exit and pipe EOF.</summary>
    public async Task<string> RunAsync(RemoteSettings settings, string command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        var start = SshProcess.Create(settings, executablePath);
        start.ArgumentList.Add("--");
        start.ArgumentList.Add(settings.SshDestination);
        start.ArgumentList.Add(command);
        using var deadline = new CancellationTokenSource(timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        await using var child = new OwnedProcess(start);
        int exitCode;
        try { exitCode = await child.Completion.WaitAsync(linked.Token).ConfigureAwait(false); }
        catch (OperationCanceledException)
        {
            await child.DisposeAsync().ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            throw new TimeoutException($"SSH command exceeded {timeout.TotalSeconds:g} seconds. {child.StandardError}".Trim());
        }
        cancellationToken.ThrowIfCancellationRequested();
        if (deadline.IsCancellationRequested) throw new TimeoutException($"SSH command exceeded {timeout.TotalSeconds:g} seconds.");
        if (exitCode != 0) throw new InvalidOperationException($"SSH exited with code {exitCode}. {child.StandardError}".Trim());
        return child.StandardOutput;
    }
}

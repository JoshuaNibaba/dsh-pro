using System.Net.Http;
using System.Reflection;
using System.Text.RegularExpressions;

namespace DshRemote;

internal static class Updater
{
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(20) };
    private static string Repository
    {
        get
        {
            var repository = Assembly.GetExecutingAssembly().GetCustomAttributes<AssemblyMetadataAttribute>()
                .Single(attribute => attribute.Key == "UpdateRepository").Value ?? "";
            if (!Regex.IsMatch(repository, @"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"))
                throw new InvalidOperationException("更新仓库格式无效。");
            return repository;
        }
    }

    internal static Uri ReleasePage => new($"https://github.com/{Repository}/releases/tag/dsh-remote-windows");

    internal static async Task<int> LatestAsync(CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"https://github.com/{Repository}/releases/download/dsh-remote-windows/DSH-Remote-Windows.version");
        request.Headers.UserAgent.ParseAdd($"DSH-Remote-Windows/{Program.Version.ToString(3)}");
        request.Headers.CacheControl = new() { NoCache = true };
        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellation);
        var bytes = new byte[65];
        var count = await stream.ReadAtLeastAsync(bytes, bytes.Length, throwOnEndOfStream: false, cancellationToken: cancellation);
        if (count >= bytes.Length || !int.TryParse(System.Text.Encoding.UTF8.GetString(bytes, 0, count).Trim(), out var build)
            || build < 1 || build > 65534)
            throw new IOException("更新服务器返回了无效版本号。");
        return build;
    }
}

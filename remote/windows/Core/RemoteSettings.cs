using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace DshRemote.Core;

/// <summary>Connection preferences only; SSH credentials remain with OpenSSH and its agent.</summary>
public sealed record RemoteSettings
{
    public string WebUrl { get; init; } = "";
    public string SshHost { get; init; } = "";
    public string SshUser { get; init; } = "";
    public int SshPort { get; init; }
    public int LocalPort { get; init; } = 18791;
    public int RemotePort { get; init; } = 18790;
    public string Service { get; init; } = "dsh-web";
    public bool PreferSsh { get; init; }
    public bool CheckUpdates { get; init; } = true;

    [JsonIgnore] public Uri? WebUri => NavigationPolicy.NormalizeWebUrl(WebUrl);
    [JsonIgnore] public string SshDestination => string.IsNullOrEmpty(SshUser) || SshHost.Contains('@') ? SshHost : $"{SshUser}@{SshHost}";

    /// <summary>Rejects invalid configured routes, ports and shell/SSH option injection.</summary>
    public void Validate()
    {
        if (WebUrl is null || SshHost is null || SshUser is null || Service is null)
            throw new ArgumentException("Connection settings cannot contain null strings.");
        if (WebUrl.Length > 0 && WebUri is null)
            throw new ArgumentException("Web URL must be an HTTP or HTTPS address without user information.");
        ValidatePort(SshPort, nameof(SshPort), allowDefault: true);
        ValidatePort(LocalPort, nameof(LocalPort));
        ValidatePort(RemotePort, nameof(RemotePort));
        ValidateService(Service);
        if (SshUser.Length > 0 && !Regex.IsMatch(SshUser, @"\A[A-Za-z0-9_][A-Za-z0-9_.-]*\z"))
            throw new ArgumentException("SSH user must start with a letter, digit or underscore and contain no whitespace or shell syntax.");
        if (SshHost.Length > 0)
        {
            var parts = SshHost.Split('@');
            if (parts.Length > 2 || (parts.Length == 2 && !Regex.IsMatch(parts[0], @"\A[A-Za-z0-9_][A-Za-z0-9_.-]*\z")))
                throw new ArgumentException("SSH host must be a host name, address, alias or user@host.");
            var host = parts[^1];
            var validName = Regex.IsMatch(host, @"\A[A-Za-z0-9_][A-Za-z0-9_.-]*\z");
            var validAddress = !host.Any(char.IsWhiteSpace) && IPAddress.TryParse(host, out _);
            if (!validName && !validAddress)
                throw new ArgumentException("SSH host contains invalid characters or starts with an option prefix.");
        }
        if (SshHost.Length == 0 && SshUser.Length > 0)
            throw new ArgumentException("An SSH user requires an SSH host.");
        if (WebUri is null && SshHost.Length == 0)
            throw new ArgumentException("Configure a valid Web URL or SSH host.");
    }

    internal static void ValidatePort(int port, string name, bool allowDefault = false)
    {
        if (port < (allowDefault ? 0 : 1) || port > 65535)
            throw new ArgumentOutOfRangeException(name, $"{name} must be {(allowDefault ? "0 (OpenSSH default) or " : "")}between 1 and 65535.");
    }

    internal static void ValidateService(string service)
    {
        if (service is null || service.Length > 255 || !Regex.IsMatch(service, @"\A[A-Za-z0-9_][A-Za-z0-9_.@-]*\z"))
            throw new ArgumentException("Service must be a safe systemd unit name (letters, digits, _, ., @ and -).", nameof(service));
    }
}

/// <summary>JSON preferences; missing files mean first launch, malformed files produce a path-qualified error.</summary>
public static class SettingsStore
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };

    public static RemoteSettings Load(string path)
    {
        try
        {
            var settings = JsonSerializer.Deserialize<RemoteSettings>(File.ReadAllText(path), Options)
                ?? throw new JsonException("Expected a settings object.");
            settings.Validate();
            return settings;
        }
        catch (FileNotFoundException) { return new RemoteSettings(); }
        catch (DirectoryNotFoundException) { return new RemoteSettings(); }
        catch (Exception error) when (error is JsonException or ArgumentException)
        {
            throw new InvalidDataException($"Invalid settings in '{path}': {error.Message}", error);
        }
    }

    /// <summary>Validates before replacing the settings file; stores no password or derived URI fields.</summary>
    public static void Save(string path, RemoteSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        settings.Validate();
        var fullPath = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(fullPath)!;
        Directory.CreateDirectory(directory);
        var temporary = Path.Combine(directory, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            using (var stream = new FileStream(temporary, options))
            {
                JsonSerializer.Serialize(stream, settings, Options);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, fullPath, overwrite: true);
        }
        finally
        {
            File.Delete(temporary);
        }
    }
}

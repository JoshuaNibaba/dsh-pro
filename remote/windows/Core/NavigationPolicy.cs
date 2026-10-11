namespace DshRemote.Core;

/// <summary>Limits in-app navigation to an exact origin and external navigation to web protocols.</summary>
public static class NavigationPolicy
{
    /// <summary>Adds HTTPS when no scheme is given; returns null for empty, malformed or credential-bearing addresses.</summary>
    public static Uri? NormalizeWebUrl(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var text = raw.Trim();
        if (text.Any(char.IsControl) || text.Contains('\\')) return null;
        if (!text.Contains("://", StringComparison.Ordinal))
        {
            // A bare host may carry a numeric port; URI schemes without // are not host names.
            if (!System.Text.RegularExpressions.Regex.IsMatch(text, @"\A(?:\[[0-9A-Fa-f:.%]+\]|[^:/?#]+)(?::[0-9]+)?(?:[/?#].*)?\z")) return null;
            text = "https://" + text;
        }
        return Uri.TryCreate(text, UriKind.Absolute, out var uri) && SafeExternal(uri) && uri.UserInfo.Length == 0
            && !string.IsNullOrEmpty(uri.Host) && uri.Port is >= 1 and <= 65535 ? uri : null;
    }

    public static bool SameOrigin(Uri left, Uri right) => SafeExternal(left) && SafeExternal(right)
        && string.Equals(left.Scheme, right.Scheme, StringComparison.OrdinalIgnoreCase)
        && string.Equals(left.IdnHost, right.IdnHost, StringComparison.OrdinalIgnoreCase) && left.Port == right.Port;

    public static bool SafeExternal(Uri uri) => uri.IsAbsoluteUri && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
}

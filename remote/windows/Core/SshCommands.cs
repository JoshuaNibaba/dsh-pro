using System.Text.RegularExpressions;

namespace DshRemote.Core;

/// <summary>Fixed remote administration commands with validated, shell-quoted systemd unit names.</summary>
public static class SshCommands
{
    private static string Unit(string service)
    {
        RemoteSettings.ValidateService(service);
        return "'" + service + "'";
    }

    public static string LoginUrl(string service)
    {
        var unit = Unit(service);
        return "f=~dsh/.dsh-remote/url; if [ -s \"$f\" ]; then cat \"$f\"; else "
            + $"{{ sudo -n journalctl -u {unit} -o cat --no-pager -n 200 2>/dev/null || journalctl -u {unit} -o cat --no-pager -n 200; }}"
            + " | grep -o 'dsh web: http[^ ]*' | tail -1 | cut -d' ' -f3; fi";
    }

    public static string Logs(string service)
    {
        var unit = Unit(service);
        return $"systemctl status {unit} --no-pager 2>&1 | head -5; echo; sudo -n journalctl -u {unit} -o cat --no-pager -n 200 2>/dev/null || journalctl -u {unit} -o cat --no-pager -n 200; echo; dsh --version";
    }

    public static string Restart(string service)
    {
        var unit = Unit(service);
        return $"sudo -n systemctl restart {unit} 2>/dev/null || systemctl restart {unit}";
    }

    /// <summary>Copies only the first nonempty login token into the loopback root URL, discarding the remote origin, path and other parameters.</summary>
    public static Uri? ParseLoginUrl(string output, int localPort)
    {
        RemoteSettings.ValidatePort(localPort, nameof(localPort));
        foreach (Match match in Regex.Matches(output, @"https?://[^\s<>""']+", RegexOptions.IgnoreCase))
        {
            var source = NavigationPolicy.NormalizeWebUrl(match.Value);
            if (source is null) continue;
            foreach (var item in source.Query.TrimStart('?').Split('&'))
            {
                var pair = item.Split('=', 2);
                if (pair.Length != 2 || Uri.UnescapeDataString(pair[0]) != "token") continue;
                var token = Uri.UnescapeDataString(pair[1].Replace("+", " "));
                if (token.Length == 0) continue;
                return new Uri($"http://127.0.0.1:{localPort}/?token={Uri.EscapeDataString(token)}");
            }
        }
        return null;
    }
}

// User settings (defaults domain com.joshua.dsh-remote). Nothing is preset:
// the first launch opens the settings window.
//
//   server      SSH host: IP, domain, ~/.ssh/config alias, or user@host ("" = no SSH)
//   sshPort     SSH port (0 = ssh default or ~/.ssh/config)
//   sshUser     SSH user ("" = ssh default or ~/.ssh/config)
//   webURL      password-protected web address, e.g. https://dsh.example.com ("" = none)
//   autoUpdate  check GitHub releases for new versions (default true)
//   remotePort  dsh web port on the server (default 18790)
//   localPort   local SSH tunnel port (default 18791; dsh's login cookie is bound to it)
//   service     systemd unit of dsh web (default dsh-web)

import Foundation

struct Settings {
    var server: String
    var sshPort: Int
    var sshUser: String
    var webURL: String
    var autoUpdate: Bool
    var remotePort: Int
    var localPort: Int
    var service: String

    static func load() -> Settings {
        let d = UserDefaults.standard
        if d.string(forKey: "server") == nil, let legacy = d.string(forKey: "host") {
            d.set(legacy, forKey: "server")
            d.removeObject(forKey: "host")
        }
        return Settings(
            server: (d.string(forKey: "server") ?? "").trimmed,
            sshPort: d.integer(forKey: "sshPort"),
            sshUser: (d.string(forKey: "sshUser") ?? "").trimmed,
            webURL: (d.string(forKey: "webURL") ?? "").trimmed,
            autoUpdate: d.object(forKey: "autoUpdate") as? Bool ?? true,
            remotePort: d.object(forKey: "remotePort") as? Int ?? 18790,
            localPort: d.object(forKey: "localPort") as? Int ?? 18791,
            service: d.string(forKey: "service") ?? "dsh-web")
    }

    func save() {
        let d = UserDefaults.standard
        d.set(server, forKey: "server")
        d.set(sshPort, forKey: "sshPort")
        d.set(sshUser, forKey: "sshUser")
        d.set(webURL, forKey: "webURL")
        d.set(autoUpdate, forKey: "autoUpdate")
    }

    var isConfigured: Bool { !server.isEmpty || web != nil }

    /// `user@server`, or the server as typed when it already names a user or no user is set.
    var sshDestination: String {
        sshUser.isEmpty || server.contains("@") ? server : "\(sshUser)@\(server)"
    }

    var sshPortArgs: [String] { sshPort > 0 ? ["-p", String(sshPort)] : [] }

    /// The web address with a scheme and a trailing slash, or nil when unset or invalid.
    var web: URL? { Settings.normalizeWeb(webURL) }

    static func normalizeWeb(_ raw: String) -> URL? {
        var s = raw.trimmed
        if s.isEmpty { return nil }
        if !s.contains("://") { s = "https://" + s }
        guard var c = URLComponents(string: s), let scheme = c.scheme?.lowercased(),
              scheme == "https" || scheme == "http", let host = c.host, !host.isEmpty else { return nil }
        if c.path.isEmpty { c.path = "/" }
        return c.url
    }

    var displayName: String { !server.isEmpty ? server : (web?.host ?? "") }

    /// Hosts whose pages load inside the app; anything else opens in the default browser.
    var internalHosts: Set<String> {
        var hosts: Set<String> = ["127.0.0.1"]
        if let h = web?.host { hosts.insert(h) }
        return hosts
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

// SSH access to the server: one-shot commands and the `ssh -L` tunnel. Both use
// BatchMode, so only key (or ssh-agent) authentication is attempted; a server
// that would ask for a password fails fast and the app falls back to the web address.

import Foundation

enum SSH {
    static let common = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                         "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
                         "-o", "StrictHostKeyChecking=accept-new"]

    /// Runs one remote command and returns its stdout, or throws with ssh's stderr.
    static func run(_ s: Settings, _ command: String) throws -> String {
        try SSHCommand().run(s, command)
    }

    /// Prints dsh web's current authenticated URL. The server writes it to
    /// ~dsh/.dsh-remote/url (install.sh); older installs only have the journal.
    static func urlCommand(_ service: String) -> String {
        "f=~dsh/.dsh-remote/url; if [ -s \"$f\" ]; then cat \"$f\"; else "
            + "{ sudo -n journalctl -u \(service) -o cat --no-pager -n 200 2>/dev/null || journalctl -u \(service) -o cat --no-pager -n 200; }"
            + " | grep -o 'dsh web: http[^ ]*' | tail -1 | cut -d' ' -f3; fi"
    }

    /// Extracts a token URL from command output, tolerating shell startup notices on separate lines.
    static func localLoginURL(_ output: String, port: Int) -> URL? {
        for line in output.components(separatedBy: .newlines) {
            guard let source = URLComponents(string: line.trimmed),
                  source.scheme == "http" || source.scheme == "https",
                  let token = source.queryItems?.first(where: { $0.name == "token" })?.value,
                  !token.isEmpty else { continue }
            var local = URLComponents()
            local.scheme = "http"
            local.host = "127.0.0.1"
            local.port = port
            local.path = "/"
            local.queryItems = [URLQueryItem(name: "token", value: token)]
            return local.url
        }
        return nil
    }

    static func logsCommand(_ service: String) -> String {
        "systemctl status \(service) --no-pager 2>&1 | head -5; echo; "
            + "sudo -n journalctl -u \(service) -o cat --no-pager -n 200 2>/dev/null || journalctl -u \(service) -o cat --no-pager -n 200; "
            + "echo; dsh --version"
    }

    static func restartCommand(_ service: String) -> String {
        "sudo -n systemctl restart \(service) 2>/dev/null || systemctl restart \(service)"
    }
}

final class Tunnel {
    private let lock = NSRecursiveLock()
    private let executableURL: URL
    private var process: Process?
    private var closed = false
    private var errorMessage = ""
    private var directory: URL?
    private var errorWriter: FileHandle?
    private var errorReader: FileHandle?
    private var progressBuffer = ""
    private var startedAt: TimeInterval = 0
    var onExit: ((String) -> Void)?
    var onProgress: ((String) -> Void)?

    init(executableURL: URL = URL(fileURLWithPath: "/usr/bin/ssh")) {
        self.executableURL = executableURL
    }

    var lastError: String {
        lock.lock()
        defer { lock.unlock() }
        if errorMessage.isEmpty, process?.isRunning == false, let root = directory {
            return Tunnel.readError(root.appendingPathComponent("stderr"))
        }
        return errorMessage
    }

    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return process?.isRunning ?? false
    }

    func start(_ s: Settings) throws {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else {
            throw NSError(domain: "ssh", code: 1, userInfo: [NSLocalizedDescriptionKey: "客户端已退出"])
        }
        stop()
        errorMessage = ""
        // A short private path fits macOS's Unix-domain socket limit and cannot reuse a stale master.
        let root = URL(fileURLWithPath: "/tmp").appendingPathComponent("dsh-ssh-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        directory = root
        let errURL = root.appendingPathComponent("stderr")
        guard FileManager.default.createFile(atPath: errURL.path, contents: nil,
                                              attributes: [.posixPermissions: 0o600]) else {
            cleanup()
            throw NSError(domain: "ssh", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法创建 SSH 日志"])
        }
        let p = Process()
        p.executableURL = executableURL
        p.arguments = SSH.common + s.sshPortArgs + [
            "-v", "-N", "-o", "ExitOnForwardFailure=yes",
            "-o", "ControlMaster=yes", "-o", "ControlPersist=no", "-o", "ControlPath=\(root.path)/control",
            "-L", "127.0.0.1:\(s.localPort):127.0.0.1:\(s.remotePort)", s.sshDestination]
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.terminationHandler = { [weak self] proc in
            let msg = Tunnel.readError(errURL)
            DispatchQueue.main.async {
                guard let self else { return }
                self.lock.lock()
                guard self.process === proc else { self.lock.unlock(); return }
                self.process = nil
                self.errorMessage = msg
                self.cleanup()
                self.lock.unlock()
                self.onExit?(msg)
            }
        }
        do {
            let writer = try FileHandle(forWritingTo: errURL)
            errorWriter = writer
            errorReader = try FileHandle(forReadingFrom: errURL)
            p.standardError = writer
            progressBuffer = ""
            startedAt = ProcessInfo.processInfo.systemUptime
            try p.run()
            process = p
        } catch {
            cleanup()
            throw error
        }
    }

    func shutdown() {
        lock.lock()
        defer { lock.unlock() }
        closed = true
        stop()
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        if let p = process {
            process = nil
            if p.isRunning { p.terminate(); p.waitUntilExit() }
        }
        cleanup()
    }

    private func cleanup() {
        try? errorWriter?.close()
        try? errorReader?.close()
        errorWriter = nil
        errorReader = nil
        if let root = directory { try? FileManager.default.removeItem(at: root) }
        directory = nil
    }

    private static func readError(_ url: URL) -> String {
        guard let reader = try? FileHandle(forReadingFrom: url) else { return "" }
        defer { try? reader.close() }
        let end = reader.seekToEndOfFile()
        reader.seek(toFileOffset: end > 32768 ? end - 32768 : 0)
        return String(decoding: reader.readDataToEndOfFile(), as: UTF8.self)
            .components(separatedBy: "\n")
            .filter { !$0.hasPrefix("debug") && !$0.hasPrefix("OpenSSH_") }
            .joined(separator: "\n").trimmed
    }

    private func pollProgress() {
        lock.lock()
        let data = errorReader?.readDataToEndOfFile() ?? Data()
        progressBuffer += String(decoding: data, as: UTF8.self)
        var lines: [String] = []
        while let newline = progressBuffer.firstIndex(of: "\n") {
            lines.append(String(progressBuffer[..<newline]))
            progressBuffer.removeSubrange(...newline)
        }
        progressBuffer = String(progressBuffer.suffix(16384))
        let elapsed = ProcessInfo.processInfo.systemUptime - startedAt
        let progress = onProgress
        lock.unlock()
        for line in lines {
            let detail: String
            if line.contains("Executing proxy command") {
                detail = "using configured SSH proxy"
            } else if ["Connecting to ", "Connection established", "Remote protocol version",
                       "Authenticated to ", "Offering public key", "Next authentication method"]
                .contains(where: { line.contains($0) }) {
                detail = line
            } else { continue }
            progress?("ssh +\(String(format: "%.3f", elapsed))s: \(detail)")
        }
    }

    /// Runs a command over this tunnel's authenticated transport; a dead master cannot fall back to a new TCP connection.
    func run(_ s: Settings, _ command: String, using runner: SSHCommand, timeout: TimeInterval = 10) throws -> String {
        lock.lock()
        guard let root = directory, process?.isRunning == true else {
            lock.unlock()
            throw NSError(domain: "ssh", code: 1, userInfo: [NSLocalizedDescriptionKey: "SSH 隧道已断开"])
        }
        let path = root.appendingPathComponent("control").path
        lock.unlock()
        return try runner.run(s, command, options: ["-T", "-o", "ControlMaster=no", "-o", "ControlPath=\(path)",
                                                     "-o", "ProxyCommand=/usr/bin/false"], timeout: timeout)
    }

    /// Waits for both the authenticated master's socket and its local forward.
    func waitReady(_ s: Settings, timeout: TimeInterval, cancelled: () -> Bool = { false }) -> Bool {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        while ProcessInfo.processInfo.systemUptime < deadline {
            if cancelled() { return false }
            pollProgress()
            lock.lock()
            let path = directory?.appendingPathComponent("control").path
            let running = process?.isRunning ?? false
            lock.unlock()
            if !running { return false }
            if let path, FileManager.default.fileExists(atPath: path), Tunnel.canConnect(port: s.localPort) { return true }
            Thread.sleep(forTimeInterval: 0.05)
        }
        return false
    }

    /// Stops an `ssh -L 127.0.0.1:<port>:` left behind by a previous instance that
    /// did not exit cleanly. Other listeners on the port are left alone.
    /// - Returns: true when an orphaned tunnel was stopped.
    @discardableResult
    static func reclaimOrphan(port: Int) -> Bool {
        let lsof = Process()
        lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        lsof.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"]
        let out = Pipe()
        lsof.standardOutput = out
        lsof.standardError = FileHandle.nullDevice
        guard (try? lsof.run()) != nil else { return false }
        let pids = (String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "")
            .split(separator: "\n").compactMap { Int32($0) }
        lsof.waitUntilExit()
        var reclaimed = false
        for pid in pids {
            let ps = Process()
            ps.executableURL = URL(fileURLWithPath: "/bin/ps")
            ps.arguments = ["-o", "command=", "-p", String(pid)]
            let psOut = Pipe()
            ps.standardOutput = psOut
            guard (try? ps.run()) != nil else { continue }
            let cmd = String(data: psOut.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            ps.waitUntilExit()
            if cmd.hasPrefix("/usr/bin/ssh ") && cmd.contains("-L 127.0.0.1:\(port):") {
                kill(pid, SIGTERM)
                reclaimed = true
            }
        }
        if reclaimed { Thread.sleep(forTimeInterval: 0.5) }
        return reclaimed
    }

    static func canConnect(port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(UInt16(port).bigEndian)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        return withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }
}

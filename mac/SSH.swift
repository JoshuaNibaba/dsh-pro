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
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        p.arguments = common + s.sshPortArgs + [s.sshDestination, command]
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        try p.run()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        if p.terminationStatus != 0 {
            let msg = (String(data: errData, encoding: .utf8) ?? "").trimmed
            throw NSError(domain: "ssh", code: Int(p.terminationStatus),
                          userInfo: [NSLocalizedDescriptionKey: msg.isEmpty ? "ssh 退出码 \(p.terminationStatus)" : msg])
        }
        return String(data: data, encoding: .utf8) ?? ""
    }

    /// Prints dsh web's current authenticated URL. The server writes it to
    /// ~dsh/.dsh-remote/url (install.sh); older installs only have the journal.
    static func urlCommand(_ service: String) -> String {
        "f=~dsh/.dsh-remote/url; if [ -s \"$f\" ]; then cat \"$f\"; else "
            + "{ sudo -n journalctl -u \(service) -o cat --no-pager -n 200 2>/dev/null || journalctl -u \(service) -o cat --no-pager -n 200; }"
            + " | grep -o 'dsh web: http[^ ]*' | tail -1 | cut -d' ' -f3; fi"
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
    var onExit: ((String) -> Void)?

    init(executableURL: URL = URL(fileURLWithPath: "/usr/bin/ssh")) {
        self.executableURL = executableURL
    }

    var lastError: String {
        lock.lock()
        defer { lock.unlock() }
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
        let p = Process()
        p.executableURL = executableURL
        p.arguments = SSH.common + s.sshPortArgs + [
            "-N", "-o", "ExitOnForwardFailure=yes",
            "-o", "ControlMaster=no", "-o", "ControlPath=none",
            "-L", "127.0.0.1:\(s.localPort):127.0.0.1:\(s.remotePort)", s.sshDestination]
        let err = Pipe()
        p.standardError = err
        p.standardOutput = FileHandle.nullDevice
        p.terminationHandler = { [weak self] proc in
            let msg = (String(data: err.fileHandleForReading.availableData, encoding: .utf8) ?? "").trimmed
            DispatchQueue.main.async {
                guard let self else { return }
                self.lock.lock()
                guard self.process === proc else { self.lock.unlock(); return }
                self.process = nil
                self.errorMessage = msg
                self.lock.unlock()
                self.onExit?(msg)
            }
        }
        try p.run()
        process = p
    }

    func close() {
        lock.lock()
        defer { lock.unlock() }
        closed = true
        stop()
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        guard let p = process else { return }
        process = nil
        if p.isRunning { p.terminate(); p.waitUntilExit() }
    }

    /// Polls the local forward until it accepts a TCP connection.
    func waitReady(_ s: Settings, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !isRunning { return false }
            if Tunnel.canConnect(port: s.localPort) { return true }
            Thread.sleep(forTimeInterval: 0.2)
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

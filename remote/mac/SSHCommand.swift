import Foundation

/// Owns a bounded, cancellable SSH command. Files capture both streams without pipe backpressure.
final class SSHCommand {
    private let lock = NSLock()
    private let executableURL: URL
    private var process: Process?
    private var cancelled = false

    init(executableURL: URL = URL(fileURLWithPath: "/usr/bin/ssh")) {
        self.executableURL = executableURL
    }

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        defer { lock.unlock() }
        cancelled = true
        if let p = process, p.isRunning { kill(p.processIdentifier, SIGKILL) }
    }

    func run(_ s: Settings, _ command: String, options: [String] = [], timeout: TimeInterval = 30) throws -> String {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        let outURL = root.appendingPathComponent("stdout"), errURL = root.appendingPathComponent("stderr")
        for url in [outURL, errURL] {
            guard FileManager.default.createFile(atPath: url.path, contents: nil,
                                                  attributes: [.posixPermissions: 0o600]) else {
                throw NSError(domain: "ssh", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法创建 SSH 输出文件"])
            }
        }
        let out = try FileHandle(forWritingTo: outURL)
        defer { try? out.close() }
        let err = try FileHandle(forWritingTo: errURL)
        defer { try? err.close() }
        let p = Process(), finished = DispatchSemaphore(value: 0)
        p.executableURL = executableURL
        p.arguments = SSH.common + options + s.sshPortArgs + [s.sshDestination, command]
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = out
        p.standardError = err
        p.terminationHandler = { _ in finished.signal() }
        lock.lock()
        guard !cancelled, process == nil else {
            lock.unlock()
            throw NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled,
                          userInfo: [NSLocalizedDescriptionKey: "SSH 请求已取消"])
        }
        do { try p.run() } catch { lock.unlock(); throw error }
        process = p
        lock.unlock()
        defer {
            lock.lock()
            process = nil
            lock.unlock()
        }
        let timedOut = finished.wait(timeout: .now() + max(0, timeout)) == .timedOut
        if timedOut {
            lock.lock()
            if p.isRunning { kill(p.processIdentifier, SIGKILL) }
            lock.unlock()
        }
        p.waitUntilExit()
        if isCancelled {
            throw NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled,
                          userInfo: [NSLocalizedDescriptionKey: "SSH 请求已取消"])
        }
        if timedOut {
            throw NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut,
                          userInfo: [NSLocalizedDescriptionKey: "SSH 命令等待超过 \(Int(timeout)) 秒"])
        }
        if p.terminationStatus != 0 {
            let msg = (try String(contentsOf: errURL, encoding: .utf8)).trimmed
            throw NSError(domain: "ssh", code: Int(p.terminationStatus), userInfo: [NSLocalizedDescriptionKey:
                msg.isEmpty ? "ssh 退出码 \(p.terminationStatus)" : msg])
        }
        return try String(contentsOf: outURL, encoding: .utf8)
    }
}

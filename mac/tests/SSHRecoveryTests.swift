import Foundation

private final class ManualScheduler {
    var delays: [TimeInterval] = []
    var actions: [() -> Void] = []
    var cancellations = 0

    func schedule(_ delay: TimeInterval, _ action: @escaping () -> Void) -> (() -> Void) {
        delays.append(delay)
        actions.append(action)
        return { self.cancellations += 1 }
    }
}

@main
struct SSHRecoveryTests {
    static func main() throws {
        retriesSurviveRepeatedFailures()
        obsoleteRetriesCannotRun()
        loginURLParsing()
        try commandLifecycle()
        try tunnelLifecycle()
        try realMultiplexing()
        print("SSH retry, cancellation, timeout and real OpenSSH multiplexing checks passed")
    }

    static func retriesSurviveRepeatedFailures() {
        let scheduler = ManualScheduler()
        let recovery = SSHRecovery(schedule: scheduler.schedule)
        var attempts = 0
        precondition(recovery.failed { attempts += 1 } == nil)
        recovery.start()
        for expected in [2.0, 4, 8, 16, 30, 30, 30] {
            precondition(recovery.failed { attempts += 1 } == expected)
            scheduler.actions.last!()
        }
        precondition(attempts == 7, "Retries must continue after the first failed reconnection")
        precondition(recovery.isActive)
        recovery.reset()
        precondition(recovery.failed { attempts += 1 } == 2, "Recovery resets the backoff")
        recovery.stop()
    }

    static func obsoleteRetriesCannotRun() {
        let scheduler = ManualScheduler()
        let recovery = SSHRecovery(schedule: scheduler.schedule)
        var attempts = 0
        recovery.start()
        recovery.failed { attempts += 1 }
        let beforeReset = scheduler.actions.last!
        recovery.reset()
        beforeReset()
        precondition(attempts == 0, "A network-triggered retry must invalidate the old timer")
        recovery.failed { attempts += 1 }
        let beforeReplacement = scheduler.actions.last!
        recovery.failed { attempts += 1 }
        beforeReplacement()
        precondition(attempts == 0, "Only the latest timer may start a connection")
        let beforeStop = scheduler.actions.last!
        recovery.stop()
        recovery.start()
        beforeStop()
        precondition(attempts == 0, "An old route must not reconnect after switching back to SSH")
        recovery.failed { attempts += 1 }
        scheduler.actions.last!()
        precondition(attempts == 1)
        recovery.stop()
        precondition(scheduler.cancellations == 3)
    }

    static func tunnelLifecycle() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = root.appendingPathComponent("ssh")
        let script = """
        #!/bin/sh
        cd "$(dirname "$0")"
        printf '%s\\n' "$@" > arguments
        for arg in "$@"; do
            case "$arg" in ControlPath=*) control="${arg#ControlPath=}" ;; esac
        done
        case " $* " in
            *' -N '*) ;;
            *)
                test -e "$control" || exit 255
                case " $* " in *' ProxyCommand=/usr/bin/false '*) ;; *) exit 254 ;; esac
                printf 'http://127.0.0.1:18790/?token=fixture\\n'
                exit 0
                ;;
        esac
        count=0
        if [ -f attempts ]; then read count < attempts; fi
        count=$((count + 1))
        echo "$count" > attempts
        if [ "$count" -le 2 ]; then
            echo 'network unavailable' >&2
            exit 255
        fi
        touch "$control"
        exec /bin/sleep 60
        """
        try script.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let tunnel = Tunnel(executableURL: executable)
        defer { tunnel.shutdown() }
        let scheduler = ManualScheduler()
        let recovery = SSHRecovery(schedule: scheduler.schedule)
        recovery.start()
        var exits = 0
        let settings = Settings(server: "example", sshPort: 2222, sshUser: "dsh", webURL: "",
                                preferSSH: true, autoUpdate: false, remotePort: 18790,
                                localPort: 18791, service: "dsh-web")
        tunnel.onExit = { message in
            exits += 1
            precondition(message.contains("network unavailable"))
            recovery.failed { try! tunnel.start(settings) }
        }
        try tunnel.start(settings)
        waitUntil { exits == 1 }
        precondition(!tunnel.isRunning)
        precondition(tunnel.lastError.contains("network unavailable"))
        scheduler.actions.last!()
        waitUntil { exits == 2 }
        scheduler.actions.last!()
        waitUntil {
            (try? String(contentsOf: root.appendingPathComponent("attempts"), encoding: .utf8).trimmed) == "3"
        }
        precondition(tunnel.isRunning, "The third SSH attempt must survive two network failures")
        precondition(scheduler.delays == [2, 4])
        let arguments = try String(contentsOf: root.appendingPathComponent("arguments"), encoding: .utf8)
            .components(separatedBy: "\n")
        for value in ["BatchMode=yes", "ConnectTimeout=10", "ServerAliveInterval=10", "ServerAliveCountMax=3",
                      "ControlMaster=yes", "ControlPersist=no", "ExitOnForwardFailure=yes",
                      "127.0.0.1:18791:127.0.0.1:18790", "dsh@example", "2222"] {
            precondition(arguments.contains(value), "Missing SSH option: \(value)")
        }
        let control = arguments.first(where: { $0.hasPrefix("ControlPath=") })!.dropFirst("ControlPath=".count)
        waitUntil { FileManager.default.fileExists(atPath: String(control)) }
        let runner = SSHCommand(executableURL: executable)
        let output = try tunnel.run(settings, "read-url", using: runner)
        precondition(SSH.localLoginURL(output, port: settings.localPort) != nil)
        precondition(!tunnel.waitReady(settings, timeout: 20, cancelled: { true }))
        recovery.stop()
        tunnel.stop()
        precondition(!FileManager.default.fileExists(atPath: String(control)), "A stopped master must remove its socket")
        try tunnel.start(settings)
        waitUntil {
            (try? String(contentsOf: root.appendingPathComponent("attempts"), encoding: .utf8).trimmed) == "4"
        }
        precondition(exits == 2, "Stopping an old process must not report loss of its replacement")
        tunnel.shutdown()
        precondition(!tunnel.isRunning)
        do {
            try tunnel.start(settings)
            preconditionFailure("An application that has quit must not create another tunnel")
        } catch {
            precondition(!tunnel.isRunning)
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        precondition(exits == 2, "Intentional shutdown must not schedule recovery")
    }

    static func loginURLParsing() {
        let output = "Welcome to the server\nhttp://localhost:18790/?token=a%26b%3Dc\nShell notice\n"
        let url = SSH.localLoginURL(output, port: 18791)!
        precondition(url.host == "127.0.0.1" && url.port == 18791)
        precondition(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "a&b=c")
        precondition(SSH.localLoginURL("Welcome\nhttp://localhost:18790/", port: 18791) == nil)
        precondition(SSH.localLoginURL("http://localhost/?token=", port: 18791) == nil)
    }

    static func commandLifecycle() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = root.appendingPathComponent("ssh")
        let script = """
        #!/bin/sh
        cd "$(dirname "$0")"
        for arg in "$@"; do action="$arg"; done
        case "$action" in
            large-output)
                i=0
                while [ "$i" -lt 4096 ]; do
                    printf '0123456789012345678901234567890123456789\\n'
                    printf '0123456789012345678901234567890123456789\\n' >&2
                    i=$((i + 1))
                done
                ;;
            fail) echo 'authentication denied' >&2; exit 7 ;;
            stall) exec /bin/sleep 60 ;;
            hold) touch started; exec /bin/sleep 60 ;;
        esac
        """
        try script.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let s = Settings(server: "example", sshPort: 0, sshUser: "dsh", webURL: "", preferSSH: true,
                         autoUpdate: false, remotePort: 18790, localPort: 18791, service: "dsh-web")
        let runner = SSHCommand(executableURL: executable)
        let output = try runner.run(s, "large-output", timeout: 10)
        precondition(output.utf8.count == 41 * 4096,
                     "Both streams must drain even when stderr exceeds pipe capacity")
        do {
            _ = try runner.run(s, "fail")
            preconditionFailure("An SSH command failure must propagate")
        } catch {
            precondition((error as NSError).code == 7 && error.localizedDescription.contains("authentication denied"))
        }
        let skipped = SSHCommand(executableURL: executable)
        skipped.cancel()
        do {
            _ = try skipped.run(s, "hold")
            preconditionFailure("A cancelled command must not launch")
        } catch { precondition((error as NSError).code == NSURLErrorCancelled) }
        let marker = root.appendingPathComponent("started")
        precondition(!FileManager.default.fileExists(atPath: marker.path))
        do {
            _ = try runner.run(s, "stall", timeout: 0.2)
            preconditionFailure("A live but stalled SSH command must time out")
        } catch { precondition((error as NSError).code == NSURLErrorTimedOut) }
        let cancelled = SSHCommand(executableURL: executable)
        let canceller = DispatchGroup()
        canceller.enter()
        DispatchQueue.global().async {
            defer { canceller.leave() }
            let deadline = ProcessInfo.processInfo.systemUptime + 5
            while !FileManager.default.fileExists(atPath: marker.path), ProcessInfo.processInfo.systemUptime < deadline {
                Thread.sleep(forTimeInterval: 0.01)
            }
            cancelled.cancel()
        }
        defer { canceller.wait() }
        do {
            _ = try cancelled.run(s, "hold", timeout: 10)
            preconditionFailure("An in-flight command must stop when cancelled")
        } catch { precondition((error as NSError).code == NSURLErrorCancelled) }
        precondition(FileManager.default.fileExists(atPath: marker.path), "Cancellation must cover a running process")
    }

    /// A loopback-only sshd fixture verifies one authentication for forwarding and remote commands.
    static func realMultiplexing() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        for name in ["host", "user"] {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/ssh-keygen")
            p.arguments = ["-q", "-t", "ed25519", "-N", "", "-f", root.appendingPathComponent(name).path]
            try p.run()
            p.waitUntilExit()
            precondition(p.terminationStatus == 0, "Fixture key generation failed")
        }
        let sshPort = try unusedPort()
        let serverConfig = root.appendingPathComponent("server-config")
        try """
        ListenAddress 127.0.0.1
        Port \(sshPort)
        HostKey \(root.path)/host
        AuthorizedKeysFile \(root.path)/user.pub
        PidFile \(root.path)/pid
        StrictModes no
        UsePAM no
        UseDNS no
        PasswordAuthentication no
        KbdInteractiveAuthentication no
        AuthenticationMethods publickey
        AllowTcpForwarding yes
        LogLevel VERBOSE
        """.write(to: serverConfig, atomically: true, encoding: .utf8)
        let serverLog = root.appendingPathComponent("server-log")
        FileManager.default.createFile(atPath: serverLog.path, contents: nil)
        let logHandle = try FileHandle(forWritingTo: serverLog)
        defer { try? logHandle.close() }
        let server = Process()
        server.executableURL = URL(fileURLWithPath: "/usr/sbin/sshd")
        server.arguments = ["-D", "-e", "-f", serverConfig.path]
        server.standardOutput = FileHandle.nullDevice
        server.standardError = logHandle
        try server.run()
        defer { if server.isRunning { server.terminate(); server.waitUntilExit() } }
        waitUntil {
            if !server.isRunning {
                let detail = (try? String(contentsOf: serverLog, encoding: .utf8)) ?? ""
                preconditionFailure("Fixture sshd exited: \(detail)")
            }
            return Tunnel.canConnect(port: sshPort)
        }
        let clientConfig = root.appendingPathComponent("client-config")
        try """
        Host *
            IdentityFile \(root.path)/user
            IdentitiesOnly yes
            IdentityAgent none
            UserKnownHostsFile \(root.path)/known-hosts
            GlobalKnownHostsFile /dev/null
        Host fixture
            HostName 127.0.0.1
        """.write(to: clientConfig, atomically: true, encoding: .utf8)
        let wrapper = root.appendingPathComponent("ssh")
        try """
        #!/bin/sh
        exec /usr/bin/ssh -F "$(dirname "$0")/client-config" "$@"
        """.write(to: wrapper, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: wrapper.path)
        let s = Settings(server: "fixture", sshPort: sshPort, sshUser: NSUserName(), webURL: "",
                         preferSSH: true, autoUpdate: false, remotePort: sshPort,
                         localPort: try unusedPort(), service: "fixture")
        let tunnel = Tunnel(executableURL: wrapper)
        defer { tunnel.shutdown() }
        var progress: [String] = []
        tunnel.onProgress = { progress.append($0) }
        try tunnel.start(s)
        precondition(tunnel.waitReady(s, timeout: 20), "Real SSH tunnel must authenticate and listen: \(tunnel.lastError)")
        let runner = SSHCommand(executableURL: wrapper)
        let output = try tunnel.run(s, "printf 'http://127.0.0.1:18790/?token=fixture\\n'", using: runner)
        precondition(SSH.localLoginURL(output, port: s.localPort)?.port == s.localPort)
        precondition(progress.contains(where: { $0.contains("Authenticated to ") }), "Authentication timing must be recorded: \(progress)")
        let firstLog = try String(contentsOf: serverLog, encoding: .utf8)
        precondition(firstLog.components(separatedBy: "Accepted publickey for").count - 1 == 1,
                     "Fetching the URL must reuse the tunnel's authentication")
        tunnel.stop()
        try tunnel.start(s)
        precondition(tunnel.waitReady(s, timeout: 20), "Recovery must establish a fresh transport")
        _ = try tunnel.run(s, "printf 'ready'", using: runner)
        let secondLog = try String(contentsOf: serverLog, encoding: .utf8)
        precondition(secondLog.components(separatedBy: "Accepted publickey for").count - 1 == 2,
                     "Each recovered tunnel must authenticate exactly once")
        print("Loopback sshd: initial connection and recovery each authenticated once")
    }

    static func unusedPort() throws -> Int {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        var size = socklen_t(MemoryLayout<sockaddr_in>.size)
        let result = withUnsafeMutablePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                guard bind(fd, $0, size) == 0 else { return Int32(-1) }
                return getsockname(fd, $0, &size)
            }
        }
        guard result == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        return Int(UInt16(bigEndian: addr.sin_port))
    }

    static func waitUntil(_ condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(5)
        while !condition(), Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        precondition(condition(), "Timed out waiting for the fake SSH process")
    }
}

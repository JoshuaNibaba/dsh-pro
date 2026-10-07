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
        try tunnelLifecycle()
        print("SSH retry and process lifecycle checks passed")
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
        count=0
        if [ -f attempts ]; then read count < attempts; fi
        count=$((count + 1))
        echo "$count" > attempts
        if [ "$count" -le 2 ]; then
            echo 'network unavailable' >&2
            exit 255
        fi
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
                      "ControlMaster=no", "ControlPath=none", "ExitOnForwardFailure=yes",
                      "127.0.0.1:18791:127.0.0.1:18790", "dsh@example", "2222"] {
            precondition(arguments.contains(value), "Missing SSH option: \(value)")
        }
        recovery.stop()
        tunnel.stop()
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

    static func waitUntil(_ condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(5)
        while !condition(), Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        precondition(condition(), "Timed out waiting for the fake SSH process")
    }
}

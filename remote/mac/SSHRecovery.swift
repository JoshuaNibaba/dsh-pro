// Main-thread ownership of SSH retries, including cancellation of obsolete callbacks.
import Foundation

final class SSHRecovery {
    typealias Scheduler = (TimeInterval, @escaping () -> Void) -> (() -> Void)

    /// A failed attempt already spends up to ConnectTimeout; short gaps let a brief path loss recover quickly.
    static let initialDelay: TimeInterval = 1
    static let maximumDelay: TimeInterval = 10

    private let schedule: Scheduler
    private var cancelScheduled: (() -> Void)?
    private var revision = 0
    private var nextDelay = SSHRecovery.initialDelay
    private(set) var isActive = false

    init(schedule: @escaping Scheduler = SSHRecovery.scheduleOnMain) {
        self.schedule = schedule
    }

    func start() {
        isActive = true
    }

    func stop() {
        isActive = false
        reset()
    }

    /// Successful connections and explicit retries restart the backoff sequence.
    func reset() {
        cancelPending()
        nextDelay = SSHRecovery.initialDelay
    }

    /// Retries continue until success, a route change, or application exit.
    @discardableResult
    func failed(_ retry: @escaping () -> Void) -> TimeInterval? {
        guard isActive else { return nil }
        cancelPending()
        let delay = nextDelay
        nextDelay = min(nextDelay * 2, SSHRecovery.maximumDelay)
        let current = revision
        cancelScheduled = schedule(delay) { [weak self] in
            guard let self, self.isActive, self.revision == current else { return }
            self.cancelScheduled = nil
            retry()
        }
        return delay
    }

    func cancelPending() {
        revision += 1
        cancelScheduled?()
        cancelScheduled = nil
    }

    private static func scheduleOnMain(_ delay: TimeInterval, _ action: @escaping () -> Void) -> (() -> Void) {
        let item = DispatchWorkItem(block: action)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
        return { item.cancel() }
    }
}

/// Measures one outage under a loaded dsh page, which shows dsh's own reconnecting indicator meanwhile.
struct KeptPageOutage {
    /// After this long the status page replaces the dsh page to report the SSH error.
    static let limit: TimeInterval = 60

    private(set) var started: TimeInterval?

    /// Records a failed reconnection at `now` (system uptime).
    /// - Returns: whether the page may stay on screen.
    mutating func failed(at now: TimeInterval) -> Bool {
        let start = started ?? now
        started = start
        return now - start < KeptPageOutage.limit
    }

    mutating func reset() {
        started = nil
    }
}

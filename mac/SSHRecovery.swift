// Main-thread ownership of SSH retries, including cancellation of obsolete callbacks.
import Foundation

final class SSHRecovery {
    typealias Scheduler = (TimeInterval, @escaping () -> Void) -> (() -> Void)

    private let schedule: Scheduler
    private var cancelScheduled: (() -> Void)?
    private var revision = 0
    private var nextDelay: TimeInterval = 2
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
        nextDelay = 2
    }

    /// Retries continue until success, a route change, or application exit.
    @discardableResult
    func failed(_ retry: @escaping () -> Void) -> TimeInterval? {
        guard isActive else { return nil }
        cancelPending()
        let delay = nextDelay
        nextDelay = min(nextDelay * 2, 30)
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

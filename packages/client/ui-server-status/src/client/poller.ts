/** Connection-aware, nonoverlapping server-status requests. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { Config } from '../config.ts'
import type { ServerSnapshot } from '../types.ts'
import { parseSnapshot } from '../wire.ts'

/** Private observable readings; connection lifecycle is read directly from Connection. */
export interface MetricsReading {
  snapshot: ServerSnapshot | null
  latencyMs: number | null
}
const empty = (): MetricsReading => ({ snapshot: null, latencyMs: null })

/** Poller owned by one plugin effect; stop resolves after the active request settles. */
export class StatusPoller {
  /** Cached readings published only by the current connected request. */
  readonly metrics = createSnapshotStore<MetricsReading>(empty())
  private stopped = true
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: { abort: AbortController; done: Promise<void> } | undefined
  private unsubscribe: (() => void) | undefined
  private revision = 0

  constructor(
    private readonly connection: Pick<ConnectionHandle, 'state' | 'rpc'>,
    private readonly config: Config,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Start immediately when connected and listen for connection transitions. */
  start(): void {
    this.stopped = false
    this.unsubscribe = this.connection.state.subscribe(() => { this.changed() })
    this.changed()
  }

  private changed(): void {
    this.revision++
    clearTimeout(this.timer)
    this.timer = undefined
    this.metrics.set(empty())
    this.active?.abort.abort()
    if (!this.stopped && this.connection.state.getSnapshot() === 'connected' && this.active === undefined) {
      this.request()
    }
  }

  private request(): void {
    const abort = new AbortController()
    const revision = this.revision
    const started = this.now()
    const timeout = setTimeout(() => {
      if (!this.stopped && revision === this.revision) this.metrics.set(empty())
      abort.abort()
    }, this.config.requestTimeoutMs)
    const run = async (): Promise<void> => {
      try {
        const result = await this.connection.rpc.call('/server-status', 'snapshot', {}, abort.signal)
        if (!result.ok) throw new Error('server-status: request failed')
        const snapshot = parseSnapshot(result.value)
        if (!abort.signal.aborted && !this.stopped && revision === this.revision) {
          this.metrics.set({ snapshot, latencyMs: Math.max(0, this.now() - started) })
        }
      } catch (error) {
        // Transport, timeout and malformed readings share an unavailable UI state.
        void error
        if (!this.stopped && revision === this.revision) this.metrics.set(empty())
      } finally {
        clearTimeout(timeout)
      }
    }
    const done = run().finally(() => {
      this.active = undefined
      if (this.stopped || this.connection.state.getSnapshot() !== 'connected') return
      if (revision !== this.revision) this.request()
      else this.timer = setTimeout(() => { this.request() }, this.config.sampleIntervalMs)
    })
    this.active = { abort, done }
  }

  /** Withdraw notifications, cancel timers, and await the pending RPC.
   * @returns Completion after no request or publication remains active.
   */
  async stop(): Promise<void> {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    clearTimeout(this.timer)
    this.timer = undefined
    this.active?.abort.abort()
    await this.active?.done
    this.metrics.set(empty())
  }
}

/** Polling lifecycle, cancellation and stale-result regressions. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConnectionRpcResult, ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { StatusPoller } from '../src/client/poller.ts'

const snapshot = { cpuPercent: 25, memory: { usedBytes: 1024, totalBytes: 4096 } }
const empty = { snapshot: null, latencyMs: null }
const config = { sampleIntervalMs: 3000, requestTimeoutMs: 5000 }
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }

function fixture(initial: ConnectionState = 'connected') {
  const state = createSnapshotStore<ConnectionState | undefined>(initial)
  const requests: { signal: AbortSignal; resolve: (value: ConnectionRpcResult<unknown>) => void; reject: (error: Error) => void }[] = []
  const rpc = {
    call: vi.fn((_channel: string, _endpoint: string, _payload: unknown, signal?: AbortSignal) =>
      new Promise<ConnectionRpcResult<unknown>>((resolve, reject) => {
        requests.push({ signal: signal!, resolve, reject })
      })),
  }
  let now = 0
  const poller = new StatusPoller({ state, rpc }, config, () => now)
  poller.start()
  return { state, requests, rpc, poller, clock: (value: number) => { now = value } }
}

afterEach(() => { vi.useRealTimers() })

describe('status polling', () => {
  it('measures the same RPC round trip and never overlaps slow requests', async () => {
    vi.useFakeTimers()
    const f = fixture()
    expect(f.rpc.call).toHaveBeenCalledWith('/server-status', 'snapshot', {}, expect.any(AbortSignal))
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.requests).toHaveLength(1)
    f.clock(42)
    f.requests[0]!.resolve({ ok: true, value: snapshot })
    await flush()
    expect(f.poller.metrics.getSnapshot()).toEqual({ snapshot, latencyMs: 42 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.requests).toHaveLength(2)
    const stop = f.poller.stop()
    expect(f.requests[1]!.signal.aborted).toBe(true)
    f.requests[1]!.reject(new Error('aborted'))
    await stop
    await vi.advanceTimersByTimeAsync(30000)
    expect(f.requests).toHaveLength(2)
  })

  it('clears stale readings on disconnect and polls immediately after reconnect', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.requests[0]!.resolve({ ok: true, value: snapshot })
    await flush()
    f.state.set('connecting')
    expect(f.poller.metrics.getSnapshot()).toEqual(empty)
    f.state.set('connected')
    expect(f.requests).toHaveLength(2)
    f.state.set('disconnected')
    expect(f.requests[1]!.signal.aborted).toBe(true)
    f.state.set('connected')
    expect(f.requests).toHaveLength(2)
    f.requests[1]!.resolve({ ok: true, value: snapshot })
    await flush()
    expect(f.requests).toHaveLength(3)
    expect(f.poller.metrics.getSnapshot()).toEqual(empty)
    const stop = f.poller.stop()
    f.requests[2]!.reject(new Error('aborted'))
    await stop
  })

  it('aborts timed-out requests, clears readings and waits for RPC quiescence', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.requests[0]!.resolve({ ok: true, value: snapshot })
    await flush()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.requests[1]!.signal.aborted).toBe(true)
    expect(f.poller.metrics.getSnapshot()).toEqual(empty)
    let finished = false
    const stopped = f.poller.stop().then(() => { finished = true })
    await flush()
    expect(finished).toBe(false)
    f.requests[1]!.resolve({ ok: true, value: snapshot })
    await stopped
    expect(f.poller.metrics.getSnapshot()).toEqual(empty)
    f.state.set('connected')
    expect(f.requests).toHaveLength(2)
  })

  it.each(['disconnect', 'stop'] as const)('keeps cancelled readings stable when the old timeout fires after %s', async (cancel) => {
    vi.useFakeTimers()
    const f = fixture()
    f.requests[0]!.resolve({ ok: true, value: snapshot })
    await flush()
    await vi.advanceTimersByTimeAsync(config.sampleIntervalMs)
    let stopped: Promise<void> | undefined
    if (cancel === 'stop') stopped = f.poller.stop()
    else f.state.set('disconnected')
    expect(f.requests[1]!.signal.aborted).toBe(true)
    const cancelledReading = f.poller.metrics.getSnapshot()
    await vi.advanceTimersByTimeAsync(config.requestTimeoutMs)
    expect(f.poller.metrics.getSnapshot()).toBe(cancelledReading)
    expect(f.poller.metrics.getSnapshot()).toEqual(cancel === 'disconnect' ? empty : { snapshot, latencyMs: 0 })
    expect(f.requests).toHaveLength(2)
    stopped ??= f.poller.stop()
    let finished = false
    const settled = stopped.then(() => { finished = true })
    await flush()
    expect(finished).toBe(false)
    f.requests[1]!.resolve({ ok: true, value: snapshot })
    await settled
    expect(f.poller.metrics.getSnapshot()).toEqual(empty)
    await vi.advanceTimersByTimeAsync(config.sampleIntervalMs)
    expect(f.requests).toHaveLength(2)
  })

  it.each([
    { ok: false, error: { code: 'unavailable', message: 'failure', details: {} } },
    { ok: true, value: { cpuPercent: 999, memory: null } },
  ] as const)('clears readings on failed or malformed response %j', async (result) => {
    vi.useFakeTimers()
    const f = fixture('disconnected')
    expect(f.requests).toHaveLength(0)
    f.state.set('connected')
    f.requests[0]!.resolve({ ok: true, value: snapshot })
    await flush()
    await vi.advanceTimersByTimeAsync(3000)
    f.requests[1]!.resolve(result)
    await flush()
    expect(f.poller.metrics.getSnapshot()).toEqual(empty)
    await f.poller.stop()
  })
})

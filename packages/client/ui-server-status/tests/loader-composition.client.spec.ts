// @vitest-environment jsdom
/** Real Client Loader lifecycle with Host bootstrap timings and production slot machinery. */
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConnectionStateSource } from '@deepseek-ai/dsh-client-connection/client'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/src/rpc.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Status from '../src/client/index.ts'

let runtime: SlotTestRuntime | undefined
let fixtureDir: string | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (fixtureDir !== undefined) {
    if (!fixtureDir.startsWith(join(tmpdir(), 'dsh-server-status-client-'))) throw new Error('unexpected fixture directory')
    await rm(fixtureDir, { recursive: true, force: true })
    fixtureDir = undefined
  }
})

describe('browser status in a real Loader composition', () => {
  it.each([
    { source: 'Host bootstrap', bootstrap: { sampleIntervalMs: 250, requestTimeoutMs: 1234 }, interval: 250, timeout: 1234 },
    { source: 'Client YAML', bootstrap: undefined, interval: 320, timeout: 876 },
  ])('uses $source timings and withdraws its slot and polling on disposal', async ({ bootstrap, interval, timeout }) => {
    runtime = await SlotTestRuntime.create()
    const ctx = runtime.ctx
    ctx.baseUrl = pathToFileURL(`${import.meta.dirname}/fixtures/`).href
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    ctx.slots.installLocale(locale)
    await runtime.declare({ 'conversation.composer.dock': { kind: 'list', scope: 'session' } })
    const state = createSnapshotStore<ReturnType<ConnectionStateSource['getSnapshot']>>('connected')
    const signals: AbortSignal[] = []
    const transport = {
      name: 'server-status-test-connection',
      apply(child: Context) {
        child.provide('connection', {
          state,
          rpc: {
            call(_channel: string, _endpoint: string, _payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
              signals.push(signal)
              return new Promise((resolve) => {
                signal.addEventListener('abort', () => {
                  resolve({ ok: false, error: { code: 'aborted', message: 'aborted', details: {} } })
                }, { once: true })
              })
            },
          },
        })
      },
    }
    vi.stubGlobal('__DSH_SERVER_STATUS_CONFIG__', bootstrap)
    vi.useFakeTimers()
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins[transport.name] = transport
    ctx.loader.builtins['server-status'] = Status
    fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-server-status-client-'))
    const configPath = join(fixtureDir, 'cordis.yml')
    await writeFile(configPath, await readFile(join(import.meta.dirname, 'fixtures/client.yml'), 'utf8'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: configPath } })
    await ctx.loader.await()
    expect(signals).toHaveLength(1)
    expect(ctx.slots.entries('conversation.composer.dock').map(row => row.options.id)).toContain('server-status')
    const sessionId = await runtime.sessions.add({ id: 'server-status-view' })
    const session = runtime.sessions.retainFor(ctx, sessionId)
    await session.ready
    const view = runtime.renderSlot('conversation.composer.dock', {}, { session })
    expect(view.container.textContent).toBe('ConnectedServer CPU UnavailableServer memory UnavailableRound trip Unavailable')
    expect(view.view.getByLabelText('DSH server status')).toBeDefined()
    await vi.advanceTimersByTimeAsync(timeout - 1)
    expect(signals[0]!.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signals[0]!.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(interval - 1)
    expect(signals).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(signals).toHaveLength(2)
    const entry = [...ctx.loader.entries()].find(row => row.options.name === 'cordis:server-status')!
    await entry.fiber!.dispose()
    expect(signals[1]!.aborted).toBe(true)
    expect(ctx.slots.entries('conversation.composer.dock').map(row => row.options.id)).not.toContain('server-status')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(signals).toHaveLength(2)
  })
})

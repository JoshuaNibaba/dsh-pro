/** Web transport delegates module and entry changes to the page-owned controller. */
import { Context } from '@deepseek-ai/cordis'
import type { ClientModuleLoader } from '@deepseek-ai/dsh-client-modules/client'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, inject, internals } from '../src/client/index.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** Mount the transport over a fake EventSource and a page running graph revision `rev`. */
async function mount(rev: string) {
  const ctx = new Context()
  const sync = vi.fn(async () => {})
  const reload = vi.fn(async () => {})
  const manifest = { rev }
  ctx.provide('modules', { entries: { sync, reload }, manifest } as unknown as ClientModuleLoader)
  const warnings = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  vi.spyOn(ctx.logger, 'info').mockImplementation(() => {})
  const reloadPage = vi.spyOn(internals, 'reloadPage').mockImplementation(() => {})
  const listeners = new Map<string, (event: { data: string }) => void>()
  const close = vi.fn()
  vi.stubGlobal('EventSource', class {
    close = close
    addEventListener(name: string, listener: (event: { data: string }) => void) { listeners.set(name, listener) }
  })
  const fiber = ctx.plugin({ apply, inject })
  await fiber.await()
  const receive = (frame: unknown): void => { listeners.get('message')!({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) }) }
  const reopen = (): void => { listeners.get('open')!({ data: '' }) }
  const dispose = async (): Promise<void> => { await fiber.dispose(); await ctx.fiber.dispose() }
  return { sync, reload, manifest, warnings, errors, reloadPage, close, receive, reopen, dispose }
}

it('forwards full graphs and rebuilt frames, contains wire errors and closes its EventSource', async () => {
  const h = await mount('r')
  try {
    const graph = { rev: 'r', entries: [], batches: [] }
    h.receive({ type: 'graph', graph })
    h.receive({ type: 'rebuilt', id: 'a', rev: 'r1' })
    await vi.waitFor(() => { expect(h.sync).toHaveBeenCalledWith(graph) })
    expect(h.reload).toHaveBeenCalledWith('a', 'r1')
    h.receive('{')
    h.receive({ type: 'graph', graph: null })
    h.receive({ type: 'future' })
    expect(h.warnings).toHaveBeenCalledTimes(2)
    h.sync.mockRejectedValueOnce(new Error('invalid graph'))
    h.receive({ type: 'graph', graph: {} })
    await vi.waitFor(() => { expect(h.errors).toHaveBeenCalledWith(expect.objectContaining({ message: 'invalid graph' })) })
    expect(h.reloadPage).not.toHaveBeenCalled()
  } finally {
    await h.dispose()
  }
  expect(h.close).toHaveBeenCalledOnce()
})

it('reloads the page when a reconnection opens with another graph, and applies changes seen while connected', async () => {
  const h = await mount('r0')
  try {
    h.receive({ type: 'graph', graph: { rev: 'r0', entries: [], batches: [] } })
    // A change published during the connection applies live.
    const changed = { rev: 'r1', entries: [], batches: [] }
    h.receive({ type: 'graph', graph: changed })
    await vi.waitFor(() => { expect(h.sync).toHaveBeenCalledWith(changed) })
    h.manifest.rev = 'r1'
    // The same graph after a reconnection (a plain Host restart) keeps the page.
    h.reopen()
    h.receive({ type: 'graph', graph: { rev: 'r1', entries: [], batches: [] } })
    expect(h.reloadPage).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(h.sync).toHaveBeenCalledTimes(2) })
    // Another graph after a reconnection (a redeployed Host) reloads instead of replacing plugins.
    h.sync.mockClear()
    h.reopen()
    h.receive({ type: 'graph', graph: { rev: 'r2', entries: [], batches: [] } })
    expect(h.reloadPage).toHaveBeenCalledOnce()
    expect(h.close).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(h.sync).not.toHaveBeenCalled()
  } finally {
    await h.dispose()
  }
})

it('treats a first graph without a revision as another graph', async () => {
  const h = await mount('r0')
  try {
    h.receive({ type: 'graph', graph: { entries: [] } })
    expect(h.reloadPage).toHaveBeenCalledOnce()
  } finally {
    await h.dispose()
  }
})

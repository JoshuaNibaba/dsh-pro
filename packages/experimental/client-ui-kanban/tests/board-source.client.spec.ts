/** The board mirror follows the selected Workspace only while the page subscribes. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KanbanBoard } from '@deepseek-ai/dsh-experimental-kanban/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { describe, expect, it, vi } from 'vitest'
import { createBoardSource, type BoardStream } from '../src/client/board-source.ts'
import { createKanbanViewState } from '../src/client/view-state.ts'

const WS1 = brandString<WorkspaceId>('ws-1')
const WS2 = brandString<WorkspaceId>('ws-2')

/** A controllable stream: tests push boards or failures and observe disposal. */
function controlledStream(sticky = false) {
  const queue: (KanbanBoard | { readonly fail: unknown })[] = []
  let wake: (() => void) | undefined
  let closed = false
  const accept = vi.fn()
  const dispose = vi.fn(async () => { closed = !sticky; wake?.() })
  const stream: BoardStream = {
    async * [Symbol.asyncIterator]() {
      while (!closed) {
        const next = queue.shift()
        if (next === undefined) { await new Promise<void>((resolve) => { wake = resolve }); continue }
        if ('fail' in next) throw next.fail
        yield { value: next, accept }
      }
    },
    dispose,
  }
  return {
    stream,
    accept,
    dispose,
    push(item: KanbanBoard | { readonly fail: unknown }) { queue.push(item); wake?.() },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function fixture(initial: WorkspaceId | null = WS1, sticky = false) {
  const view = createKanbanViewState()
  view.store.set({ workspaceId: initial, collapsed: {} })
  const selection = { set: (workspaceId: WorkspaceId | null) => { view.store.set({ ...view.store.getSnapshot(), workspaceId }) } }
  const streams: ReturnType<typeof controlledStream>[] = []
  const open = vi.fn((_workspaceId: WorkspaceId) => {
    const stream = controlledStream(sticky)
    streams.push(stream)
    return stream.stream
  })
  const source = createBoardSource({ selection: view.selection, open })
  return { view, selection, streams, open, source }
}

describe('board source', () => {
  it('opens on the first subscriber, publishes boards, and closes after the last one leaves', async () => {
    const { source, open, streams } = fixture()
    expect(source.getSnapshot().status).toBe('idle')
    const listener = vi.fn()
    const off = source.subscribe(listener)
    const second = source.subscribe(() => {})
    expect(open).toHaveBeenCalledTimes(1)
    expect(source.getSnapshot()).toEqual({ workspaceId: WS1, status: 'loading', board: null, error: null })
    streams[0]!.push({ workspaceId: WS1, tasks: [] })
    await settle()
    expect(source.getSnapshot()).toEqual({ workspaceId: WS1, status: 'ready', board: { workspaceId: WS1, tasks: [] }, error: null })
    expect(streams[0]!.accept).toHaveBeenCalled()
    expect(listener).toHaveBeenCalled()
    off()
    expect(streams[0]!.dispose).not.toHaveBeenCalled()
    second()
    expect(streams[0]!.dispose).toHaveBeenCalled()
  })

  it('reopens on a Workspace change and ignores items from the replaced stream', async () => {
    const { source, selection, streams, open, view } = fixture(WS1, true)
    source.subscribe(() => {})
    view.store.set({ workspaceId: WS1, collapsed: { [brandString('s')]: true } })
    expect(open).toHaveBeenCalledTimes(1)
    selection.set(WS2)
    expect(open).toHaveBeenLastCalledWith(WS2)
    streams[0]!.push({ workspaceId: WS1, tasks: [] })
    await settle()
    expect(source.getSnapshot()).toMatchObject({ workspaceId: WS2, status: 'loading', board: null })
    selection.set(WS1)
    streams[1]!.push({ fail: new Error('late') })
    await settle()
    expect(source.getSnapshot()).toMatchObject({ workspaceId: WS1, status: 'loading' })
    selection.set(null)
    expect(source.getSnapshot()).toEqual({ workspaceId: null, status: 'idle', board: null, error: null })
  })

  it('reports a stream failure and reopens on retry while keeping the last board', async () => {
    const { source, streams, open } = fixture()
    source.retry()
    expect(open).not.toHaveBeenCalled()
    source.subscribe(() => {})
    streams[0]!.push({ workspaceId: WS1, tasks: [] })
    await settle()
    streams[0]!.push({ fail: new Error('offline') })
    await settle()
    expect(source.getSnapshot()).toMatchObject({ status: 'error', error: 'offline', board: { workspaceId: WS1 } })
    source.retry()
    expect(open).toHaveBeenCalledTimes(2)
    expect(source.getSnapshot()).toMatchObject({ status: 'loading', board: { workspaceId: WS1 } })
    streams[1]!.push({ fail: 'text failure' })
    await settle()
    expect(source.getSnapshot()).toMatchObject({ status: 'error', error: 'text failure' })
  })

  it('stays idle without a selection and stops for good after disposal', async () => {
    const empty = fixture(null)
    empty.source.subscribe(() => {})
    expect(empty.open).not.toHaveBeenCalled()
    const { source, open, streams, selection } = fixture()
    source.subscribe(() => {})
    await source.dispose()
    expect(streams[0]!.dispose).toHaveBeenCalled()
    selection.set(WS2)
    source.retry()
    const late = source.subscribe(() => {})
    late()
    expect(open).toHaveBeenCalledTimes(1)
  })
})

/** The Kanban namespace, page, and sidebar entry follow Client plugin disposal. */
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { KanbanBoard, KanbanTaskId } from '@deepseek-ai/dsh-experimental-kanban/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, type TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { expect, it, vi } from 'vitest'
import type { BoardSnapshot } from '../src/client/board-source.ts'
import { KanbanHeaderLink, type KanbanHeaderLinkInjected } from '../src/client/KanbanHeaderLink.tsx'
import { KanbanIcon } from '../src/client/KanbanIcon.tsx'
import { KanbanPage, type KanbanInjected } from '../src/client/KanbanPage.tsx'
import { inject, mountKanban } from '../src/client/mount.ts'
import { apply as hostApply } from '../src/index.ts'

/** Narrow the erased registry payload before exercising its registered actions. */
function assertInjected(value: Record<string, unknown>): asserts value is Record<string, unknown> & KanbanInjected {
  expect(typeof value.selectWorkspace).toBe('function')
  expect(typeof value.hooks).toBe('object')
}

/** Narrow the erased header-link payload. */
function assertLink(value: Record<string, unknown>): asserts value is Record<string, unknown> & KanbanHeaderLinkInjected {
  expect(typeof value.openBoard).toBe('function')
}

const REMOTE: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-kanban', descriptors: [] }
const WS = brandString<WorkspaceId>('ws-1')
const ID = brandString<KanbanTaskId>('task-1')
const S1 = brandString<SessionId>('s-1')

async function fixture(fail = false) {
  const ctx = new Context(), unmount = vi.fn(async () => {})
  const streams: { name: string; opened: AsyncIterable<KanbanBoard> }[] = []
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution) {
      expect(contribution).toBe(REMOTE)
      return unmount
    }
    $stream(options: { name: string; open: (signal: AbortSignal) => AsyncIterable<KanbanBoard>; ended: () => Error }) {
      streams.push({ name: options.name, opened: options.open(new AbortController().signal) })
      expect(options.ended().message).toBe('Kanban board stream ended')
      return {
        async * [Symbol.asyncIterator]() { yield { value: { workspaceId: WS, tasks: [] }, accept() {} } },
        dispose: async () => {},
      }
    }
  }
  new Remote()
  const value = { ok: true as const, value: {} }
  const kanban = {
    follow: vi.fn(() => ({ [Symbol.asyncIterator]: async function * () {} })),
    create: vi.fn(async () => value), edit: vi.fn(async () => value), move: vi.fn(async () => value),
    retry: vi.fn(async () => value), skip: vi.fn(async () => value),
    delete: vi.fn(async () => ({ ok: false, error: new RemoteError('kanban/not-found', 'gone', { id: ID }) })),
  }
  ctx.provide('remote.kanban', kanban)
  const create = vi.fn(async () => S1)
  ctx.provide('sessions', { create })
  const openSession = vi.fn()
  ctx.provide('uiWorkspace', { openSession })
  ctx.provide('workspaces', { list: { getSnapshot: () => ({ items: [{ workspaceId: brandString<WorkspaceId>('ws-2'), sessionIds: [S1] }] }) } })
  const selectPanel = vi.fn()
  ctx.provide('layout', { selectPanel })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'conversation.session.header.links': { kind: 'list', scope: 'session' },
  } } as never, () => null)
  if (fail) vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot failed') })
  return { ctx, unmount, kanban, create, openSession, streams, selectPanel }
}

it('registers the page and sidebar entry, forwards actions, and withdraws everything on disposal', async () => {
  hostApply()
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountKanban(ctx, REMOTE) })
    await fiber
    const page = b.ctx.slots.entries('main').find(item => item.component === KanbanPage)!
    expect(page).toMatchObject({ locale: 'kanban' })
    const icon = b.ctx.slots.entriesOfSlot('sidebar.panellist').find(item => item.component === KanbanIcon)!
    expect(resolveSlotLabel(icon.options.label)).toBeTypeOf('string')
    const actions = page.inject!()
    assertInjected(actions)
    actions.selectWorkspace(WS)
    expect(actions.hooks.view.getSnapshot().workspaceId).toBe(WS)
    actions.setLaneCollapsed(S1, true)
    expect(actions.hooks.view.getSnapshot().collapsed).toEqual({ [S1]: true })
    const seen: BoardSnapshot[] = []
    const off = actions.hooks.board.subscribe(() => { seen.push(actions.hooks.board.getSnapshot()) })
    await vi.waitFor(() => { expect(seen.at(-1)?.status).toBe('ready') })
    expect(b.streams[0]?.name).toBe('Kanban board')
    expect(b.kanban.follow).toHaveBeenCalledWith(WS, expect.any(AbortSignal))
    actions.retryBoard()
    off()
    await expect(actions.createTask(WS, 'T', 'P')).resolves.toEqual({ ok: true })
    expect(b.kanban.create).toHaveBeenCalledWith({ workspaceId: WS, title: 'T', prompt: 'P' })
    await actions.editTask(ID, 'T', '')
    await actions.moveTask(ID, { kind: 'plan' })
    await actions.retryTask(ID)
    await actions.skipTask(ID)
    expect(b.kanban.edit).toHaveBeenCalledWith({ id: ID, title: 'T', prompt: '' })
    expect(b.kanban.move).toHaveBeenCalledWith({ id: ID, target: { kind: 'plan' } })
    expect(b.kanban.retry).toHaveBeenCalledWith({ id: ID })
    expect(b.kanban.skip).toHaveBeenCalledWith({ id: ID })
    await expect(actions.deleteTask(ID)).resolves.toEqual({ ok: false, message: 'gone' })
    await expect(actions.newSession(WS)).resolves.toEqual({ ok: true })
    expect(b.create).toHaveBeenCalledWith({ workspaceId: WS })
    b.create.mockRejectedValueOnce(new Error('denied'))
    await expect(actions.newSession(WS)).resolves.toEqual({ ok: false, message: 'denied' })
    b.create.mockRejectedValueOnce('text')
    await expect(actions.newSession(WS)).resolves.toEqual({ ok: false, message: 'text' })
    actions.openSession(S1)
    expect(b.openSession).toHaveBeenCalledWith(S1)
    const linkEntry = b.ctx.slots.entries('conversation.session.header.links').find(item => item.component === KanbanHeaderLink)!
    expect(linkEntry).toMatchObject({ locale: 'kanban' })
    const link = linkEntry.inject!()
    assertLink(link)
    link.openBoard(S1)
    expect(actions.hooks.view.getSnapshot().workspaceId).toBe('ws-2')
    expect(b.selectPanel).toHaveBeenLastCalledWith('kanban')
    actions.selectWorkspace(WS)
    link.openBoard(brandString<SessionId>('elsewhere'))
    expect(actions.hooks.view.getSnapshot().workspaceId).toBe(WS)
    expect(b.selectPanel).toHaveBeenCalledTimes(2)
    await fiber.dispose()
    expect(b.ctx.slots.entries('main')).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.panellist')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.session.header.links')).toHaveLength(0)
    expect(b.unmount).toHaveBeenCalledOnce()
  } finally { await b.ctx.fiber.dispose() }
})

it('rolls back the Remote contribution when the slot registration fails', async () => {
  const b = await fixture(true)
  try {
    await expect(mountKanban(b.ctx, REMOTE)).rejects.toThrow('slot failed')
    expect(b.unmount).toHaveBeenCalledOnce()
  } finally { await b.ctx.fiber.dispose() }
})

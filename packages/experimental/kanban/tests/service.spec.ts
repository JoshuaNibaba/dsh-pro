import type { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { KanbanBoard, KanbanTask, KanbanTaskId } from '../src/types.ts'
import { harness, OTHER_WORKSPACE, WORKSPACE, type HarnessOptions } from './harness.ts'

const owned: Context[] = []
afterEach(async () => {
  for (const ctx of owned.splice(0)) await ctx.fiber.dispose()
})

async function mount(options: HarnessOptions = {}) {
  const fixture = await harness(options)
  owned.push(fixture.ctx)
  const [first, second] = fixture.ids as [SessionId, SessionId]
  const tasks = async (): Promise<readonly KanbanTask[]> => (await fixture.service.board(WORKSPACE)).tasks
  const task = async (id: KanbanTaskId): Promise<KanbanTask | undefined> => (await tasks()).find(item => item.id === id)
  const statusOf = async (id: KanbanTaskId) => (await task(id))?.status
  return { ...fixture, first, second, tasks, task, statusOf }
}

/** Read one board item from a follow stream that must not have ended. */
async function nextBoard(iterator: AsyncIterator<KanbanBoard>): Promise<KanbanBoard> {
  const item = await iterator.next()
  if (item.done === true) throw new Error('follow stream ended')
  return item.value
}

const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => remoteErrorOf(error))

describe('Kanban plan pool', () => {
  it('creates, edits, reorders, and deletes drafts', async () => {
    const { service, tasks } = await mount()
    const a = await service.create({ workspaceId: WORKSPACE, title: '  A  ', prompt: 'body  ' })
    const b = await service.create({ workspaceId: WORKSPACE, title: 'B', prompt: '' })
    expect(a).toMatchObject({ title: 'A', prompt: 'body', status: 'draft', rank: 0 })
    expect(b.rank).toBe(1)
    await service.move({ id: b.id, target: { kind: 'plan', beforeId: a.id } })
    expect((await tasks()).map(item => item.title)).toEqual(['B', 'A'])
    expect(await service.move({ id: a.id, target: { kind: 'plan' } })).toMatchObject({ id: a.id, rank: 1 })
    expect(await service.edit({ id: a.id, title: 'A2', prompt: 'x' })).toMatchObject({ title: 'A2', prompt: 'x' })
    await service.delete({ id: b.id })
    expect((await tasks()).map(item => item.title)).toEqual(['A2'])
  })

  it('rejects blank or over-long text, unknown tasks, foreign Sessions, and unknown Workspaces', async () => {
    const { service } = await mount({ config: { maxTitleChars: 5, maxPromptChars: 3 } })
    expect(await failure(service.create({ workspaceId: WORKSPACE, title: '  ', prompt: '' })))
      .toMatchObject({ code: 'kanban/invalid-input', details: { field: 'title' } })
    expect(await failure(service.create({ workspaceId: WORKSPACE, title: 'toolong', prompt: '' })))
      .toMatchObject({ code: 'kanban/invalid-input', details: { field: 'title' } })
    expect(await failure(service.create({ workspaceId: WORKSPACE, title: 'ok', prompt: 'long' })))
      .toMatchObject({ code: 'kanban/invalid-input', details: { field: 'prompt' } })
    expect(await failure(service.create({ workspaceId: brandString<WorkspaceId>('nope'), title: 'ok', prompt: '' })))
      .toMatchObject({ code: 'workspace/not-found' })
    const draft = await service.create({ workspaceId: WORKSPACE, title: 'ok', prompt: '' })
    expect(await failure(service.move({ id: draft.id, target: { kind: 'lane', sessionId: brandString<SessionId>('elsewhere') } })))
      .toMatchObject({ code: 'kanban/session-outside-workspace' })
    expect(await failure(service.retry({ id: draft.id })))
      .toMatchObject({ code: 'kanban/invalid-state', details: { status: 'draft' } })
    expect(await failure(service.delete({ id: brandString<KanbanTaskId>('missing') })))
      .toMatchObject({ code: 'kanban/not-found' })
  })
})

describe('Kanban lanes', () => {
  it('sends lane tasks one at a time and completes each when its Turn completes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { service, first, adapter, statusOf, agents } = await mount({ replies: [{ kind: 'gate', open: gate }] })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'First', prompt: 'do it' })
    const b = await service.create({ workspaceId: WORKSPACE, title: 'Second', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await service.move({ id: b.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('running') })
    expect(await statusOf(b.id)).toBe('waiting')
    expect(adapter.prompts).toEqual(['First\n\ndo it'])
    const sent = agents.get(first)?.session.snapshotEvents()
      .find(event => event.type === 'user/message')
    expect(sent?.type === 'user/message' && sent.data.source).toEqual({ kind: 'kanban' })
    release()
    await vi.waitFor(async () => { expect(await statusOf(b.id)).toBe('done') })
    expect(await statusOf(a.id)).toBe('done')
    expect(adapter.prompts).toEqual(['First\n\ndo it', 'Second'])
  })

  it('pauses the lane on failure until the task is retried or skipped', async () => {
    const { service, first, statusOf, task, adapter } = await mount({ replies: [{ kind: 'fail' }, { kind: 'fail' }] })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    const b = await service.create({ workspaceId: WORKSPACE, title: 'B', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await service.move({ id: b.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('failed') })
    expect((await task(a.id))?.failure).toMatchObject({ reason: 'error' })
    expect(await statusOf(b.id)).toBe('waiting')
    await service.retry({ id: a.id })
    await vi.waitFor(async () => { expect(adapter.prompts).toEqual(['A', 'A']) })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('failed') })
    expect(await statusOf(b.id)).toBe('waiting')
    await service.skip({ id: a.id })
    expect(await statusOf(a.id)).toBe('skipped')
    await vi.waitFor(async () => { expect(await statusOf(b.id)).toBe('done') })
  })

  it('withdraws a waiting or failed task back to the plan pool', async () => {
    const { service, first, statusOf } = await mount({ replies: [{ kind: 'fail' }] })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    const b = await service.create({ workspaceId: WORKSPACE, title: 'B', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await service.move({ id: b.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('failed') })
    const withdrawn = await service.move({ id: b.id, target: { kind: 'plan' } })
    expect(withdrawn).toMatchObject({ status: 'draft' })
    expect(withdrawn.sessionId).toBeUndefined()
    const back = await service.move({ id: a.id, target: { kind: 'plan', beforeId: b.id } })
    expect(back.failure).toBeUndefined()
  })

  it('refuses to edit, move, or delete a running task', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { service, first, statusOf } = await mount({ replies: [{ kind: 'gate', open: gate }] })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('running') })
    for (const attempt of [
      service.edit({ id: a.id, title: 'x', prompt: '' }),
      service.move({ id: a.id, target: { kind: 'plan' } }),
      service.delete({ id: a.id }),
    ]) expect(await failure(attempt)).toMatchObject({ code: 'kanban/invalid-state', details: { status: 'running' } })
    release()
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('done') })
  })

  it('marks a running task for attention while a human request stays pending', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { ctx, service, first, statusOf, agents } = await mount({ replies: [{ kind: 'gate', open: gate }] })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('running') })
    let answer!: (value: 'allowed-once') => void
    const answered = new Promise<'allowed-once'>((resolve) => { answer = resolve })
    const agent = agents.get(first)!
    const outcome = ctx.waterfall('approval/request', { agent, toolName: 'bash' }, () => answered)
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('attention') })
    answer('allowed-once')
    await expect(outcome).resolves.toBe('allowed-once')
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('running') })
    // A request answered before the delay never recolors the card.
    await ctx.waterfall('user-questions/request', { questions: [], agent }, async () => ({ answers: {} }) as never)
    expect(await statusOf(a.id)).toBe('running')
    release()
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('done') })
  })

  it('returns waiting tasks to the plan pool when their Session is archived', async () => {
    const gate = new Promise<void>(() => {})
    const { ctx, service, first, statusOf, task } = await mount({ replies: [{ kind: 'gate', open: gate }] })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    const b = await service.create({ workspaceId: WORKSPACE, title: 'B', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await service.move({ id: b.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('running') })
    await ctx.parallel('workspace/session-stop', { sessionId: first })
    expect(await statusOf(b.id)).toBe('draft')
    // The Agent registry's own stop listener cancels the running Turn.
    await vi.waitFor(async () => { expect((await task(a.id))?.failure).toEqual({ reason: 'aborted' }) })
  })

  it('fails a task left running by a previous Host process', async () => {
    const gate = new Promise<void>(() => {})
    const before = await harness({ replies: [{ kind: 'gate', open: gate }] })
    const a = await before.service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await before.service.move({ id: a.id, target: { kind: 'lane', sessionId: before.ids[0]! } })
    await vi.waitFor(async () => {
      expect((await before.service.board(WORKSPACE)).tasks[0]?.status).toBe('running')
    })
    const queued = await before.service.create({ workspaceId: WORKSPACE, title: 'B', prompt: '' })
    await before.service.move({ id: queued.id, target: { kind: 'lane', sessionId: before.ids[0]! } })
    const pool = before.pool
    // Disposal stops the service before the aborted Turn can settle the task.
    await before.ctx.fiber.dispose()
    await expect(before.service.delete({ id: queued.id })).rejects.toThrow('stopping')
    const after = await mount({ pool })
    expect(await after.task(a.id)).toMatchObject({ status: 'failed', failure: { reason: 'interrupted' } })
    // The interrupted task pauses its lane, so the queued task stays unsent.
    expect(await after.statusOf(queued.id)).toBe('waiting')
  })
})

describe('Kanban dispatch edges', () => {
  it('fails a task whose Session cannot be resumed', async () => {
    const { service, statusOf, task } = await mount({ ghosts: ['ghost'] })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: brandString<SessionId>('ghost') } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('failed') })
    expect((await task(a.id))?.failure).toEqual({ reason: 'dispatch', message: 'missing Session ghost' })
  })

  it('logs a lane whose Session resolution throws and keeps its task queued', async () => {
    const { ctx, service, statusOf } = await mount({ broken: ['broken'] })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: brandString<SessionId>('broken') } })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('broken Session broken')) })
    expect(await statusOf(a.id)).toBe('waiting')
  })

  it('fails a task the Agent refuses to accept', async () => {
    const stub = { status: 'idle', followup: () => { throw new Error('closed') } }
    const { service, statusOf, task } = await mount({ stubs: { stub } })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: brandString<SessionId>('stub') } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('failed') })
    expect((await task(a.id))?.failure).toEqual({ reason: 'dispatch', message: 'Error: closed' })
  })

  it('waits for a busy Session to become idle before sending', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { service, first, agents, statusOf, adapter } = await mount({ replies: [{ kind: 'gate', open: gate }] })
    agents.get(first)?.followup(createUserMessage({ content: [{ type: 'text', text: 'human' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(adapter.prompts).toEqual(['human']) })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    expect(await statusOf(a.id)).toBe('waiting')
    release()
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('done') })
    expect(adapter.prompts).toEqual(['human', 'A'])
  })

  it('keeps running when persistence does not acknowledge the message', async () => {
    const { ctx, service, first, statusOf } = await mount({ flush: false })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('done') })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('persistence did not acknowledge'))
  })

  it('fails a task whose queued message is removed before a Turn claims it', async () => {
    const { service, first, agents, statusOf, task } = await mount()
    const agent = agents.get(first)!
    const hold = Promise.withResolvers<undefined>()
    const maintenance = agent.runMaintenance(() => hold.promise)
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('running') })
    const queued = agent.inbox.nextTurn[0]!
    const human = createUserMessage({ content: [{ type: 'text', text: 'human' }], source: { kind: 'user' } })
    agent.followup(human)
    expect(agent.inbox.remove(human.id)).toBe(true)
    expect(await statusOf(a.id)).toBe('running')
    expect(agent.inbox.remove(queued.id)).toBe(true)
    await vi.waitFor(async () => { expect((await task(a.id))?.failure).toEqual({ reason: 'discarded' }) })
    hold.resolve(undefined)
    await maintenance
  })

  it('deletes a queued lane task and leaves other Sessions untouched when one is archived', async () => {
    const { ctx, service, first, second, tasks, statusOf } = await mount({ replies: [{ kind: 'gate', open: new Promise(() => {}) }] })
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    const b = await service.create({ workspaceId: WORKSPACE, title: 'B', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await service.move({ id: b.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('running') })
    await ctx.parallel('workspace/session-stop', { sessionId: second })
    expect(await statusOf(b.id)).toBe('waiting')
    await service.delete({ id: b.id })
    expect((await tasks()).map(item => item.id)).toEqual([a.id])
  })

  it('counts concurrent human requests and clears them when the Turn ends', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { ctx, service, first, statusOf, agents } = await mount({ replies: [{ kind: 'gate', open: gate }] })
    const agent = agents.get(first)!
    const a = await service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    await service.move({ id: a.id, target: { kind: 'lane', sessionId: first } })
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('running') })
    const firstAnswer = Promise.withResolvers<'allowed-once'>()
    const secondAnswer = Promise.withResolvers<'allowed-once'>()
    const one = ctx.waterfall('approval/request', { agent, toolName: 'a' }, () => firstAnswer.promise)
    const two = ctx.waterfall('approval/request', { agent, toolName: 'b' }, () => secondAnswer.promise)
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('attention') })
    firstAnswer.resolve('allowed-once')
    await one
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(await statusOf(a.id)).toBe('attention')
    release()
    await vi.waitFor(async () => { expect(await statusOf(a.id)).toBe('done') })
    secondAnswer.resolve('allowed-once')
    await two
    expect(await statusOf(a.id)).toBe('done')
    // A request in a Session without a running task changes no card.
    const idle = agents.get(brandString<SessionId>('s-2'))!
    await ctx.waterfall('approval/request', { agent: idle, toolName: 'c' },
      () => new Promise(resolve => setTimeout(() => { resolve('allowed-once') }, 40)))
    expect(await statusOf(a.id)).toBe('done')
    // A question without an Agent belongs to no lane.
    await expect(ctx.waterfall('user-questions/request', { questions: [] }, async () => ({ answers: {} }) as never))
      .resolves.toEqual({ answers: {} })
  })
})

describe('Kanban follow stream', () => {
  it('yields the current board, then the board after each change, until aborted', async () => {
    const { service } = await mount()
    const abort = new AbortController()
    const iterator = service.follow(WORKSPACE, abort.signal)[Symbol.asyncIterator]()
    expect(await nextBoard(iterator)).toEqual({ workspaceId: WORKSPACE, tasks: [] })
    await service.create({ workspaceId: OTHER_WORKSPACE, title: 'elsewhere', prompt: '' })
    const created = service.create({ workspaceId: WORKSPACE, title: 'A', prompt: '' })
    expect((await nextBoard(iterator)).tasks.map(task => task.title)).toEqual(['A'])
    await created
    abort.abort()
    expect(await iterator.next()).toMatchObject({ done: true })
  })
})

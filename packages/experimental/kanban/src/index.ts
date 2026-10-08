/**
 * Host Kanban service: durable per-Workspace task boards and the dispatcher
 * that sends each Session lane's tasks one at a time.
 *
 * A lane sends its first waiting task only while the lane has no running,
 * attention, or failed task and the Session's Agent is idle. The task's
 * message carries producer kind `kanban`; the Turn that claims it decides the
 * outcome: `completed` finishes the task, any other end reason fails it and
 * pauses the lane until the user retries, skips, or moves it.
 */
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-user-questions/types'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import {
  boardOrder, finishTask, laneOf, messageText, moveTask, nextToSend, normalizeText, requireStatus,
  requireTask, retryTask, skipTask, turnFailure,
} from './board.ts'
import { kanbanDomain } from './storage.ts'
import type {
  KanbanBoard, KanbanCreateRequest, KanbanDeleteResult, KanbanEditRequest, KanbanFailure, KanbanMoveRequest,
  KanbanTask, KanbanTaskId, KanbanTaskRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * One Kanban task sent to its lane Session. Readers preserve this message
     * without the producer; the Kanban service matches only its live message id.
     * @persistenceAttribution
     */
    'kanban': { kind: 'kanban' }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable Kanban boards and their lane dispatcher. */
    kanban: KanbanService
  }
}

/** Deployment bounds for the Kanban service. */
export interface Config {
  /** Longest accepted task title in UTF-16 code units. */
  maxTitleChars: number
  /** Longest accepted task instruction in UTF-16 code units. */
  maxPromptChars: number
  /**
   * How long an approval or question request must stay pending before its
   * running task shows `attention`; requests an automatic answerer settles
   * sooner never recolor the card.
   */
  attentionDelayMs: number
}

const nowIso = (): string => new Date(Date.now()).toISOString()

/** Running-task facts kept only in memory; a restart fails every running task instead. */
interface Dispatch {
  readonly taskId: KanbanTaskId
  readonly messageId: MessageId
  /** Turn that claimed the message, once known. */
  turn?: number
}

/**
 * Kanban boards with a serialized write queue. Reads never resume a Session;
 * dispatch resumes a lane's Session through the Session Controller.
 */
export default class KanbanService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'storageDomain', 'sessionController', 'sessionPersistence', 'workspaceRegistry']

  static Config: z<Config> = z.object({
    maxTitleChars: z.natural().min(1).max(10_000).default(200),
    maxPromptChars: z.natural().min(1).max(1_000_000).default(20_000),
    attentionDelayMs: z.natural().max(60_000).default(500),
  })

  private readonly ready: Promise<Domain<typeof kanbanDomain>>
  private readonly initialized: PromiseLike<unknown>
  private chain: Promise<unknown> = Promise.resolve()
  private stopping = false
  /** Live dispatches by lane Session. */
  private readonly dispatches = new Map<SessionId, Dispatch>()
  /** Pending human requests by Session. */
  private readonly pendingAsks = new Map<SessionId, number>()
  private readonly watchers = new Set<(workspaceId: WorkspaceId) => void>()

  /**
   * @param ctx - Host services owning storage, Sessions, and Workspaces.
   * @param config - validated deployment bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'kanban')
    this.ready = ctx.storageDomain.open(kanbanDomain)
    this.initialized = ctx.effect(async () => {
      const domain = await this.ready
      const cleanup = ctx.effect(() => async () => {
        this.stopping = true
        await this.chain // The chain contains failures after returning them to their callers.
        await domain.close()
      })
      await this.recoverInterrupted(domain)
      const waitingLanes = this.allTasks(domain).filter(task => task.status === 'waiting').map(task => task.sessionId)
      for (const sessionId of new Set(waitingLanes)) this.requestDrive(sessionId)
      return cleanup
    })

    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') this.requestDrive(agent.id)
    })
    ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      const dispatch = this.dispatches.get(agent.id)
      if (dispatch?.messageId === message.id) dispatch.turn = turn
    })
    ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      const dispatch = this.dispatches.get(agent.id)
      if (dispatch?.messageId !== message.id) return
      this.settle(agent.id, dispatch, { reason: 'discarded' })
    })
    ctx.on('session/event', (session: Session, event) => {
      if (event.type !== 'turn/end') return
      const dispatch = this.dispatches.get(session.id)
      if (dispatch?.turn !== event.data.turn) return
      this.settle(session.id, dispatch, turnFailure(event.data.reason))
    })
    const watchAsk = async <T>(agent: Agent | undefined, next: () => Promise<T>): Promise<T> => {
      if (agent === undefined) return next()
      const sessionId = agent.id
      const ask = { counted: false }
      const timer = setTimeout(() => {
        ask.counted = true
        this.pendingAsks.set(sessionId, (this.pendingAsks.get(sessionId) ?? 0) + 1)
        this.markAttention(sessionId)
      }, this.config.attentionDelayMs)
      timer.unref()
      try {
        return await next()
      } finally {
        clearTimeout(timer)
        // A settle that ran meanwhile already cleared this Session's count.
        const count = this.pendingAsks.get(sessionId)
        if (ask.counted && count !== undefined) {
          if (count > 1) this.pendingAsks.set(sessionId, count - 1)
          else this.pendingAsks.delete(sessionId)
          this.markAttention(sessionId)
        }
      }
    }
    // Prepended so an answerer that claims the request without delegating
    // cannot hide it; the listener always delegates and returns the outcome unchanged.
    ctx.on('approval/request', (req, next) => watchAsk(req.agent, next), { prepend: true })
    ctx.on('user-questions/request', (req, next) => watchAsk(req.agent, next), { prepend: true })
    ctx.on('workspace/session-stop', async ({ sessionId }) => {
      await this.serialize(async () => {
        const domain = await this.getDomain()
        const now = nowIso()
        const waiting = laneOf(this.allTasks(domain), sessionId).filter(task => task.status === 'waiting')
        for (const task of waiting) {
          const rows = moveTask(this.workspaceTasks(domain, task.workspaceId), task.id, { kind: 'plan' }, now)
          await this.writeRows(domain, rows)
          this.emitChanged(task.workspaceId)
        }
      })
    })
  }

  async [Service.init](): Promise<void> {
    await this.initialized
  }

  /**
   * Read one Workspace board without resuming any Session.
   * @param workspaceId - Workspace whose tasks are read.
   * @returns every task of the Workspace in board order.
   */
  @Remote('board')
  async board(workspaceId: WorkspaceId): Promise<KanbanBoard> {
    const domain = await this.getDomain()
    return { workspaceId, tasks: boardOrder(this.workspaceTasks(domain, workspaceId)) }
  }

  /**
   * Follow one Workspace board: the current board first, then the complete
   * board after every committed change. Changes that land while an item is
   * unconsumed coalesce into the next item.
   * @param workspaceId - Workspace whose tasks are followed.
   * @param signal - Client observation lifetime.
   * @returns complete board snapshots.
   */
  @Remote({ mode: 'stream' })
  async *follow(workspaceId: WorkspaceId, signal: AbortSignal): AsyncIterable<KanbanBoard> {
    let dirty = true
    let wake: (() => void) | undefined
    const watcher = (changed: WorkspaceId): void => {
      if (changed !== workspaceId) return
      dirty = true
      wake?.()
    }
    const onAbort = (): void => { wake?.() }
    this.watchers.add(watcher)
    signal.addEventListener('abort', onAbort)
    try {
      while (!signal.aborted) {
        if (!dirty) {
          await new Promise<void>((resolve) => { wake = resolve })
          wake = undefined
          continue
        }
        dirty = false
        yield await this.board(workspaceId)
      }
    } finally {
      this.watchers.delete(watcher)
      signal.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Add one task at the end of a Workspace's plan pool.
   * @param request - Workspace, title, and instruction.
   * @returns the stored task.
   */
  @Remote('create')
  async create(request: KanbanCreateRequest): Promise<KanbanTask> {
    const text = normalizeText(request.title, request.prompt, this.config)
    if (this.ctx.workspaceRegistry.get(request.workspaceId) === undefined) {
      throw new RemoteError('workspace/not-found', `No Workspace "${request.workspaceId}".`, { workspaceId: request.workspaceId })
    }
    return this.serialize(async () => {
      const domain = await this.getDomain()
      const plan = this.workspaceTasks(domain, request.workspaceId).filter(task => task.status === 'draft')
      const now = nowIso()
      const task: KanbanTask = {
        id: brandString<KanbanTaskId>(`kanban-${randomUUID()}`),
        workspaceId: request.workspaceId,
        ...text,
        status: 'draft',
        rank: plan.reduce((max, candidate) => Math.max(max, candidate.rank + 1), 0),
        createdAt: now,
        updatedAt: now,
      }
      await domain.table('tasks').put(task.id, task)
      this.emitChanged(task.workspaceId)
      return task
    })
  }

  /**
   * Replace the title and instruction of a draft, waiting, or failed task.
   * @param request - task identity and replacement text.
   * @returns the stored task.
   */
  @Remote('edit')
  async edit(request: KanbanEditRequest): Promise<KanbanTask> {
    const text = normalizeText(request.title, request.prompt, this.config)
    return this.mutate(request.id, (task) => {
      requireStatus(task, ['draft', 'waiting', 'failed'])
      return [{ ...task, ...text, updatedAt: nowIso() }]
    })
  }

  /**
   * Move a draft, waiting, or failed task within the plan pool, back to it,
   * or to the end of a lane. A task moved to a lane is sent when the lane reaches it.
   * @param request - task identity and target.
   * @returns the stored task.
   */
  @Remote('move')
  async move(request: KanbanMoveRequest): Promise<KanbanTask> {
    return this.mutate(request.id, (task, tasks) => {
      if (request.target.kind === 'lane') this.requireWorkspaceSession(task.workspaceId, request.target.sessionId)
      return moveTask(tasks, request.id, request.target, nowIso())
    })
  }

  /**
   * Requeue a failed task at the head of its lane.
   * @param request - failed task identity.
   * @returns the stored task.
   */
  @Remote('retry')
  async retry(request: KanbanTaskRequest): Promise<KanbanTask> {
    return this.mutate(request.id, (_task, tasks) => [retryTask(tasks, request.id, nowIso())])
  }

  /**
   * Move a failed task to the completed column without rerunning it; the lane resumes.
   * @param request - failed task identity.
   * @returns the stored task.
   */
  @Remote('skip')
  async skip(request: KanbanTaskRequest): Promise<KanbanTask> {
    return this.mutate(request.id, (_task, tasks) => [skipTask(tasks, request.id, nowIso())])
  }

  /**
   * Delete a task that is not running.
   * @param request - task identity.
   * @returns the deleted identity.
   */
  @Remote('delete')
  async delete(request: KanbanTaskRequest): Promise<KanbanDeleteResult> {
    return this.serialize(async () => {
      const domain = await this.getDomain()
      const task = requireTask(this.allTasks(domain), request.id)
      requireStatus(task, ['draft', 'waiting', 'failed', 'done', 'skipped'])
      await domain.table('tasks').delete(task.id)
      this.emitChanged(task.workspaceId)
      this.requestDrive(task.sessionId)
      return { id: task.id, deleted: true as const }
    })
  }

  private requireWorkspaceSession(workspaceId: WorkspaceId, sessionId: SessionId): void {
    // A Workspace deleted after the task was created owns no Session either.
    if (this.ctx.workspaceRegistry.get(workspaceId)?.sessionIds.includes(sessionId) !== true) {
      throw new RemoteError('kanban/session-outside-workspace',
        `Session "${sessionId}" is not in Workspace "${workspaceId}".`, { sessionId, workspaceId })
    }
  }

  /**
   * Apply one pure transition to a task's Workspace inside the write queue,
   * then publish the change and drive the affected lanes.
   */
  private async mutate(
    id: KanbanTaskId,
    transition: (task: KanbanTask, workspaceTasks: readonly KanbanTask[]) => readonly KanbanTask[],
  ): Promise<KanbanTask> {
    return this.serialize(async () => {
      const domain = await this.getDomain()
      const task = requireTask(this.allTasks(domain), id)
      const rows = transition(task, this.workspaceTasks(domain, task.workspaceId))
      await this.writeRows(domain, rows)
      const stored = rows.find(row => row.id === id) ?? task
      if (rows.length > 0) this.emitChanged(task.workspaceId)
      for (const sessionId of new Set([task.sessionId, stored.sessionId])) this.requestDrive(sessionId)
      return stored
    })
  }

  private async writeRows(domain: Domain<typeof kanbanDomain>, rows: readonly KanbanTask[]): Promise<void> {
    const table = domain.table('tasks')
    for (const row of rows) await table.put(row.id, row)
  }

  private allTasks(domain: Domain<typeof kanbanDomain>): KanbanTask[] {
    return [...domain.table('tasks').entries()].map(([, task]) => task)
  }

  private workspaceTasks(domain: Domain<typeof kanbanDomain>, workspaceId: WorkspaceId): KanbanTask[] {
    return this.allTasks(domain).filter(task => task.workspaceId === workspaceId)
  }

  /** Fail every task a previous Host process left running; its Turn outcome is unknowable here. */
  private async recoverInterrupted(domain: Domain<typeof kanbanDomain>): Promise<void> {
    const now = nowIso()
    const stale = this.allTasks(domain).filter(task => task.status === 'running' || task.status === 'attention')
    await this.writeRows(domain, stale.map(task => finishTask(task, { reason: 'interrupted' }, now)))
  }

  /**
   * Schedule one lane check; a draft's absent lane schedules nothing.
   * @param sessionId - lane Session, or undefined for a plan-pool task.
   */
  private requestDrive(sessionId: SessionId | undefined): void {
    if (sessionId === undefined) return
    void this.background(`lane "${sessionId}" dispatch`,
      this.serialize(() => this.ctx.agents.withoutInitiator(() => this.drive(sessionId))))
  }

  /**
   * Log the failure of queue work no caller awaits, including refusals while stopping.
   * @param label - operation named in the warning.
   * @param work - detached queue work.
   * @returns the work's settlement, which never rejects.
   */
  private background(label: string, work: Promise<unknown>): Promise<void> {
    return work.then(() => undefined, (error: unknown) => {
      this.ctx.logger.warn(`kanban: ${label} failed: ${String(error)}`)
    })
  }

  /** Send the lane's next task when the lane is unblocked and its Agent is idle. */
  private async drive(sessionId: SessionId): Promise<void> {
    if (this.dispatches.has(sessionId)) return
    const domain = await this.getDomain()
    const next = nextToSend(laneOf(this.allTasks(domain), sessionId))
    if (next === undefined) return
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) {
      await this.commitSettle(domain, next, { reason: 'dispatch', message: resolved.error.message })
      return
    }
    const { agent } = resolved
    // An idle event follows the running Turn, which drives this lane again.
    if (agent.status !== 'idle') return
    const message: UserMessage = createUserMessage({
      content: [{ type: 'text', text: messageText(next) }], source: { kind: 'kanban' },
    })
    const now = nowIso()
    const running: KanbanTask = { ...next, status: 'running', startedAt: now, updatedAt: now }
    await domain.table('tasks').put(running.id, running)
    this.dispatches.set(sessionId, { taskId: running.id, messageId: message.id })
    this.emitChanged(running.workspaceId)
    try {
      agent.followup(message)
    } catch (error: unknown) {
      this.dispatches.delete(sessionId)
      await this.commitSettle(domain, running, { reason: 'dispatch', message: String(error) })
      return
    }
    if (!await this.ctx.sessions.flush(agent.session)) {
      this.ctx.logger.warn(`kanban: Session "${sessionId}" persistence did not acknowledge task "${next.id}"`)
    }
  }

  /** Record a Turn outcome for the lane's live dispatch and drive the lane. */
  private settle(sessionId: SessionId, dispatch: Dispatch, failure: KanbanFailure | undefined): void {
    this.dispatches.delete(sessionId)
    this.pendingAsks.delete(sessionId)
    // Only the dispatcher writes a running task, and it does so here, so the row is still running.
    void this.background(`settling task "${dispatch.taskId}"`, this.serialize(async () => {
      const domain = await this.getDomain()
      await this.commitSettle(domain, requireTask(this.allTasks(domain), dispatch.taskId), failure)
    })).then(() => { this.requestDrive(sessionId) })
  }

  private async commitSettle(domain: Domain<typeof kanbanDomain>, task: KanbanTask, failure: KanbanFailure | undefined): Promise<void> {
    await domain.table('tasks').put(task.id, finishTask(task, failure, nowIso()))
    this.emitChanged(task.workspaceId)
  }

  /** Reconcile the lane's running task with the pending human-request count. */
  private markAttention(sessionId: SessionId): void {
    const dispatch = this.dispatches.get(sessionId)
    if (dispatch === undefined) return
    const status = this.pendingAsks.has(sessionId) ? 'attention' : 'running'
    void this.background(`attention update for "${dispatch.taskId}"`, this.serialize(async () => {
      const domain = await this.getDomain()
      const task = requireTask(this.allTasks(domain), dispatch.taskId)
      // A settle queued earlier finished the task; a repeated reconciliation changes nothing.
      if ((task.status !== 'running' && task.status !== 'attention') || task.status === status) return
      await domain.table('tasks').put(task.id, { ...task, status, updatedAt: nowIso() })
      this.emitChanged(task.workspaceId)
    }))
  }

  /** Notify followers after a durable write; followers only mark their stream dirty. */
  private emitChanged(workspaceId: WorkspaceId): void {
    for (const watcher of this.watchers) watcher(workspaceId)
  }

  private async getDomain(): Promise<Domain<typeof kanbanDomain>> {
    await this.initialized
    return this.ready
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('Kanban service is stopping'))
    const pending = this.chain.then(work)
    this.chain = pending.catch(() => undefined) // Preserve FIFO progress after the caller receives the failure.
    return pending
  }
}

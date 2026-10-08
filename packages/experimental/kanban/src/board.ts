/**
 * Pure task-set transitions. Each operation receives the Workspace's current
 * tasks and returns the complete list of rows to write; the service persists
 * them and publishes the change afterwards.
 */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId, TurnEndReason } from '@deepseek-ai/dsh-session/types'
import type { KanbanFailure, KanbanMoveTarget, KanbanTask, KanbanTaskId, KanbanTaskStatus } from './types.ts'

/** Statuses that occupy a Session lane. */
export const LANE_STATUSES: ReadonlySet<KanbanTaskStatus> = new Set(['waiting', 'running', 'attention', 'failed'])

/** Statuses that stop a lane from sending its next waiting task. */
export const BLOCKING_STATUSES: ReadonlySet<KanbanTaskStatus> = new Set(['running', 'attention', 'failed'])

/** Statuses shown in the completed column. */
export const FINISHED_STATUSES: ReadonlySet<KanbanTaskStatus> = new Set(['done', 'skipped'])

/** Title and instruction bounds applied to every write. */
export interface TextBounds {
  readonly maxTitleChars: number
  readonly maxPromptChars: number
}

const byRank = (left: KanbanTask, right: KanbanTask): number => left.rank - right.rank || left.id.localeCompare(right.id)

/**
 * Order a Workspace's tasks for presentation: the plan pool by rank, lanes by
 * Session and rank, then finished tasks newest first.
 * @param tasks - every task of one Workspace.
 * @returns a new array in board order.
 */
export function boardOrder(tasks: readonly KanbanTask[]): KanbanTask[] {
  const plan = tasks.filter(task => task.status === 'draft').toSorted(byRank)
  const lanes = tasks.filter(task => LANE_STATUSES.has(task.status))
    .toSorted((left, right) => String(left.sessionId).localeCompare(String(right.sessionId)) || byRank(left, right))
  const finished = tasks.filter(task => FINISHED_STATUSES.has(task.status))
    .toSorted((left, right) => String(right.finishedAt).localeCompare(String(left.finishedAt)) || left.id.localeCompare(right.id))
  return [...plan, ...lanes, ...finished]
}

/**
 * Read one lane in send order.
 * @param tasks - every task of one Workspace or of all Workspaces.
 * @param sessionId - lane Session.
 * @returns the lane's tasks by ascending rank.
 */
export function laneOf(tasks: readonly KanbanTask[], sessionId: SessionId): KanbanTask[] {
  return tasks.filter(task => task.sessionId === sessionId && LANE_STATUSES.has(task.status)).toSorted(byRank)
}

/**
 * Select the task a lane sends next.
 * @param lane - one lane in send order.
 * @returns the first waiting task, or undefined while the lane is blocked or empty.
 */
export function nextToSend(lane: readonly KanbanTask[]): KanbanTask | undefined {
  if (lane.some(task => BLOCKING_STATUSES.has(task.status))) return undefined
  return lane.find(task => task.status === 'waiting')
}

/**
 * Validate and normalize user text.
 * @param title - raw title.
 * @param prompt - raw instruction.
 * @param bounds - configured limits.
 * @returns the trimmed title and the instruction with trailing whitespace removed.
 * @throws RemoteError `kanban/invalid-input` for a blank or over-long field.
 */
export function normalizeText(title: string, prompt: string, bounds: TextBounds): { title: string; prompt: string } {
  const cleanTitle = title.trim()
  if (cleanTitle === '' || cleanTitle.length > bounds.maxTitleChars) {
    throw new RemoteError('kanban/invalid-input', 'Task title must be non-blank and within the configured length.', { field: 'title' })
  }
  const cleanPrompt = prompt.trimEnd()
  if (cleanPrompt.length > bounds.maxPromptChars) {
    throw new RemoteError('kanban/invalid-input', 'Task instruction exceeds the configured length.', { field: 'prompt' })
  }
  return { title: cleanTitle, prompt: cleanPrompt }
}

/**
 * Text sent to the Session for one task.
 * @param task - task being sent.
 * @returns the title, followed by the instruction after a blank line when present.
 */
export function messageText(task: Pick<KanbanTask, 'title' | 'prompt'>): string {
  return task.prompt.trim() === '' ? task.title : `${task.title}\n\n${task.prompt}`
}

/**
 * Find one task or fail with the Remote code.
 * @param tasks - candidate tasks.
 * @param id - requested identity.
 * @returns the task.
 * @throws RemoteError `kanban/not-found`.
 */
export function requireTask(tasks: readonly KanbanTask[], id: KanbanTaskId): KanbanTask {
  const task = tasks.find(candidate => candidate.id === id)
  if (task === undefined) throw new RemoteError('kanban/not-found', `No Kanban task "${id}".`, { id })
  return task
}

/**
 * Fail unless the task is in one of the allowed statuses.
 * @param task - task about to change.
 * @param allowed - statuses the operation accepts.
 * @throws RemoteError `kanban/invalid-state`.
 */
export function requireStatus(task: KanbanTask, allowed: readonly KanbanTaskStatus[]): void {
  if (!allowed.includes(task.status)) {
    throw new RemoteError('kanban/invalid-state', `Kanban task "${task.id}" is ${task.status}.`, { id: task.id, status: task.status })
  }
}

function withoutLaneFields(task: KanbanTask): KanbanTask {
  const { sessionId: _sessionId, failure: _failure, startedAt: _startedAt, finishedAt: _finishedAt, ...rest } = task
  return rest
}

/**
 * Rewrite ranks of one ordered column as 0..n-1, returning only rows whose rank changed.
 * @param ordered - column in its new order.
 * @param changed - rows that must be written regardless of rank.
 * @returns rows to persist.
 */
function renumber(ordered: readonly KanbanTask[], changed: ReadonlySet<KanbanTaskId>): KanbanTask[] {
  return ordered.flatMap((task, rank) => task.rank === rank && !changed.has(task.id) ? [] : [{ ...task, rank }])
}

/**
 * Move a draft, waiting, or failed task.
 * @param tasks - every task of the task's Workspace.
 * @param id - moved task.
 * @param target - plan position or lane.
 * @param now - ISO-8601 write instant.
 * @returns rows to persist; empty for a no-op.
 */
export function moveTask(tasks: readonly KanbanTask[], id: KanbanTaskId, target: KanbanMoveTarget, now: string): KanbanTask[] {
  const task = requireTask(tasks, id)
  requireStatus(task, ['draft', 'waiting', 'failed'])
  if (target.kind === 'plan') {
    if (task.status === 'draft' && target.beforeId === id) return []
    const before = tasks.filter(candidate => candidate.status === 'draft').toSorted(byRank)
    const plan = before.filter(candidate => candidate.id !== id)
    const anchor = target.beforeId === undefined ? -1 : plan.findIndex(candidate => candidate.id === target.beforeId)
    const moved: KanbanTask = { ...withoutLaneFields(task), status: 'draft', updatedAt: now }
    if (anchor === -1) plan.push(moved)
    else plan.splice(anchor, 0, moved)
    if (task.status === 'draft' && plan.indexOf(moved) === before.indexOf(task)) return []
    return renumber(plan, new Set([id]))
  }
  if (task.status === 'waiting' && task.sessionId === target.sessionId) return []
  const lane = laneOf(tasks, target.sessionId).filter(candidate => candidate.id !== id)
  const last = lane.at(-1)
  const rank = last === undefined ? 0 : last.rank + 1
  return [{ ...withoutLaneFields(task), status: 'waiting', sessionId: target.sessionId, rank, updatedAt: now }]
}

/**
 * Put a failed task back at the head of its lane.
 * @param tasks - every task of the task's Workspace.
 * @param id - failed task.
 * @param now - ISO-8601 write instant.
 * @returns the row to persist.
 */
export function retryTask(tasks: readonly KanbanTask[], id: KanbanTaskId, now: string): KanbanTask {
  const task = requireTask(tasks, id)
  requireStatus(task, ['failed'])
  // Failed tasks block their lane, so no lane task has started since; the
  // failed task returns ahead of everything still waiting there.
  const others = tasks.filter(candidate => candidate.id !== task.id && candidate.sessionId === task.sessionId
    && LANE_STATUSES.has(candidate.status)).map(candidate => candidate.rank)
  const rank = Math.min(task.rank, ...others.map(other => other - 1))
  const { failure: _failure, startedAt: _startedAt, ...rest } = task
  return { ...rest, status: 'waiting', rank, updatedAt: now }
}

/**
 * Move a failed task to the completed column without rerunning it.
 * @param tasks - every task of the task's Workspace.
 * @param id - failed task.
 * @param now - ISO-8601 write instant.
 * @returns the row to persist; the failure stays recorded.
 */
export function skipTask(tasks: readonly KanbanTask[], id: KanbanTaskId, now: string): KanbanTask {
  const task = requireTask(tasks, id)
  requireStatus(task, ['failed'])
  return { ...task, status: 'skipped', finishedAt: now, updatedAt: now }
}

/**
 * Settle a running task from its Turn's end.
 * @param task - running or attention task.
 * @param failure - undefined for a completed Turn.
 * @param now - ISO-8601 write instant.
 * @returns the row to persist.
 */
export function finishTask(task: KanbanTask, failure: KanbanFailure | undefined, now: string): KanbanTask {
  if (failure === undefined) return { ...task, status: 'done', finishedAt: now, updatedAt: now }
  return { ...task, status: 'failed', failure, updatedAt: now }
}

/**
 * Classify how a task's Turn ended.
 * @param reason - the Turn's durable end reason.
 * @returns undefined for a completed Turn, otherwise the failure to record.
 */
export function turnFailure(reason: TurnEndReason): KanbanFailure | undefined {
  switch (reason.kind) {
    case 'completed': return undefined
    case 'error': return { reason: 'error', message: reason.error.message }
    case 'aborted':
    case 'blocked':
    case 'max-tokens':
    case 'interrupted':
      return { reason: reason.kind }
    default:
      // TurnEndReasonMap is merge-extensible: an unknown end is not a completion.
      return { reason: 'error', message: `Turn ended: ${reason.kind}` }
  }
}

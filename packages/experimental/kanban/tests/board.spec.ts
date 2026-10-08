import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { describe, expect, it } from 'vitest'
import { boardOrder, messageText, moveTask, nextToSend, retryTask, turnFailure } from '../src/board.ts'
import type { KanbanTask, KanbanTaskId, KanbanTaskStatus } from '../src/types.ts'

const NOW = '2026-10-08T00:00:00.000Z'
const lane = brandString<SessionId>('s')

function task(id: string, status: KanbanTaskStatus, rank: number, extra: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: brandString<KanbanTaskId>(id), workspaceId: brandString<WorkspaceId>('ws'), title: id, prompt: '', status, rank,
    createdAt: NOW, updatedAt: NOW, ...status === 'draft' ? {} : { sessionId: lane }, ...extra,
  }
}

describe('Kanban board transitions', () => {
  it('orders plan, lanes, then finished tasks newest first', () => {
    const tasks = [
      task('done-old', 'done', 0, { finishedAt: '2026-10-07T00:00:00.000Z' }),
      task('p2', 'draft', 2),
      task('w', 'waiting', 1),
      task('done-new', 'done', 0, { finishedAt: '2026-10-08T00:00:00.000Z' }),
      task('p1', 'draft', 1),
      task('p0', 'draft', 1),
      task('done-tie', 'skipped', 0, { finishedAt: '2026-10-08T00:00:00.000Z' }),
    ]
    expect(boardOrder(tasks).map(item => item.id)).toEqual(['p0', 'p1', 'p2', 'w', 'done-new', 'done-tie', 'done-old'])
  })

  it('returns no rows for a move that keeps the plan order', () => {
    const tasks = [task('a', 'draft', 0), task('b', 'draft', 1)]
    expect(moveTask(tasks, tasks[0]!.id, { kind: 'plan', beforeId: tasks[1]!.id }, NOW)).toEqual([])
    expect(moveTask(tasks, tasks[0]!.id, { kind: 'plan', beforeId: tasks[0]!.id }, NOW)).toEqual([])
    expect(moveTask(tasks, tasks[1]!.id, { kind: 'plan' }, NOW)).toEqual([])
  })

  it('rewrites a task returning to the plan even when its rank number already fits', () => {
    const tasks = [task('d', 'draft', 0), task('w', 'waiting', 1)]
    expect(moveTask(tasks, tasks[1]!.id, { kind: 'plan' }, NOW)).toEqual([
      expect.objectContaining({ id: 'w', status: 'draft', rank: 1 }),
    ])
  })

  it('appends to the lane end and keeps a same-lane waiting task in place', () => {
    const tasks = [task('w', 'waiting', 4), task('d', 'draft', 0)]
    expect(moveTask(tasks, tasks[1]!.id, { kind: 'lane', sessionId: lane }, NOW)).toEqual([
      expect.objectContaining({ id: 'd', status: 'waiting', sessionId: lane, rank: 5 }),
    ])
    expect(moveTask(tasks, tasks[0]!.id, { kind: 'lane', sessionId: lane }, NOW)).toEqual([])
  })

  it('sends only from an unblocked lane and retries a failed task first', () => {
    const failed = task('f', 'failed', 3, { failure: { reason: 'error' } })
    const waiting = task('w', 'waiting', 1)
    expect(nextToSend([waiting, failed])).toBeUndefined()
    const retried = retryTask([waiting, failed], failed.id, NOW)
    expect(retried).toMatchObject({ status: 'waiting', rank: 0 })
    expect(retried.failure).toBeUndefined()
    expect(nextToSend([retried, waiting])?.id).toBe('f')
  })

  it('sends the title alone or followed by the instruction', () => {
    expect(messageText({ title: 'T', prompt: ' ' })).toBe('T')
    expect(messageText({ title: 'T', prompt: 'P' })).toBe('T\n\nP')
  })

  it('classifies every Turn end reason', () => {
    expect(turnFailure({ kind: 'completed' })).toBeUndefined()
    expect(turnFailure({ kind: 'error', error: { message: 'boom', code: 'X' } })).toEqual({ reason: 'error', message: 'boom' })
    expect(turnFailure({ kind: 'aborted', reason: { kind: 'legacy' } })).toEqual({ reason: 'aborted' })
    expect(turnFailure({ kind: 'blocked' })).toEqual({ reason: 'blocked' })
    expect(turnFailure({ kind: 'max-tokens' })).toEqual({ reason: 'max-tokens' })
    expect(turnFailure({ kind: 'interrupted' })).toEqual({ reason: 'interrupted' })
    expect(turnFailure({ kind: 'future' } as never)).toEqual({ reason: 'error', message: 'Turn ended: future' })
  })
})

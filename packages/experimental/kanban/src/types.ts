/**
 * Browser-safe Kanban vocabulary shared by the Host service and the Web page.
 * Types only; the runtime lives in `index.ts`.
 * @module @deepseek-ai/dsh-experimental-kanban/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Identifies one Kanban task across every Workspace board. */
export type KanbanTaskId = Branded<'KanbanTaskId'>

/**
 * Lifecycle of one task.
 *
 * - `draft`: in the plan pool; editable, reorderable, never sent.
 * - `waiting`: assigned to a Session lane and not yet sent.
 * - `running`: sent to its Session; the Turn that claimed it has not ended.
 * - `attention`: running, and the Session waits for a human approval or answer.
 * - `failed`: the Turn ended without completing, or sending failed; the lane pauses.
 * - `done`: the Turn that claimed the task completed.
 * - `skipped`: a failed task the user moved to the completed column without rerunning it.
 */
export type KanbanTaskStatus = 'draft' | 'waiting' | 'running' | 'attention' | 'failed' | 'done' | 'skipped'

/** Why a task failed. */
export type KanbanFailureReason =
  /** The Turn ended with a provider or runtime error. */
  | 'error'
  /** The Turn was cancelled. */
  | 'aborted'
  /** A policy blocked the Turn. */
  | 'blocked'
  /** A step hit its output-token ceiling. */
  | 'max-tokens'
  /** The Host stopped while the task was running. */
  | 'interrupted'
  /** The queued message was removed before a Turn claimed it. */
  | 'discarded'
  /** The Session could not be resumed or did not accept the message. */
  | 'dispatch'

/** Failure facts recorded on a failed task. */
export interface KanbanFailure {
  readonly reason: KanbanFailureReason
  /** Provider or runtime message, when one exists. */
  readonly message?: string | undefined
}

/** One task as the Host stores and the Client reads it. */
export interface KanbanTask {
  readonly id: KanbanTaskId
  readonly workspaceId: WorkspaceId
  /** Non-blank card title; also the first line of the sent message. */
  readonly title: string
  /** Optional instruction body sent after the title. */
  readonly prompt: string
  readonly status: KanbanTaskStatus
  /** Lane Session for every status except `draft`. */
  readonly sessionId?: SessionId | undefined
  /** Ascending order inside the plan pool or the lane. */
  readonly rank: number
  readonly failure?: KanbanFailure | undefined
  /** ISO-8601 instants. */
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt?: string | undefined
  readonly finishedAt?: string | undefined
}

/** Complete task set of one Workspace. */
export interface KanbanBoard {
  readonly workspaceId: WorkspaceId
  /** Every task of the Workspace in plan, lane, then completion order. */
  readonly tasks: readonly KanbanTask[]
}

/** Create one plan-pool task at the end of the pool. */
export interface KanbanCreateRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly prompt: string
}

/** Replace the title and instruction of an unsent task. */
export interface KanbanEditRequest {
  readonly id: KanbanTaskId
  readonly title: string
  readonly prompt: string
}

/** Where a moved task lands. */
export type KanbanMoveTarget =
  /** Plan pool, before `beforeId` or at the end when omitted. */
  | { readonly kind: 'plan'; readonly beforeId?: KanbanTaskId }
  /** End of one Session lane of the task's Workspace. */
  | { readonly kind: 'lane'; readonly sessionId: SessionId }

/** Move one unsent or failed task. */
export interface KanbanMoveRequest {
  readonly id: KanbanTaskId
  readonly target: KanbanMoveTarget
}

/** Address one task. */
export interface KanbanTaskRequest {
  readonly id: KanbanTaskId
}

/** Result of one deletion. */
export interface KanbanDeleteResult {
  readonly id: KanbanTaskId
  readonly deleted: true
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No stored task carries that id. */
    'kanban/not-found': { readonly id: KanbanTaskId }
    /** The task's current status does not allow the operation. */
    'kanban/invalid-state': { readonly id: KanbanTaskId; readonly status: KanbanTaskStatus }
    /** A title or instruction is blank or exceeds its configured bound. */
    'kanban/invalid-input': { readonly field: 'title' | 'prompt' }
    /** The lane Session does not belong to the task's Workspace. */
    'kanban/session-outside-workspace': { readonly sessionId: SessionId; readonly workspaceId: WorkspaceId }
  }
}

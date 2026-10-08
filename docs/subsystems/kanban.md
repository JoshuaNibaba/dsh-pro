# Kanban

English | [中文](kanban.zh.md)

The experimental Kanban board plans tasks per Workspace and sends them to Sessions one at a time. The [Host service](../../packages/experimental/kanban/README.md) owns storage and dispatch, the [Conversation View](../../packages/experimental/client-ui-kanban/README.md) edits and moves tasks, and the [optional bundle](../../packages/experimental/kanban-bundle/README.md) switches both on.

## Tasks and lanes

`KanbanTaskId` brands one task. `KanbanTask` records its Workspace, title, details, `KanbanTaskStatus`, lane `sessionId`, and `rank`. A `draft` task sits in the plan pool; `waiting`, `running`, `attention`, and `failed` tasks occupy the lane of their Session; `done` and `skipped` tasks are finished. A failed task carries a `KanbanFailure` whose `KanbanFailureReason` names the Turn end reason, a restart (`interrupted`), a removed queued message (`discarded`), or a sending failure (`dispatch`). `KanbanBoard` is the complete task set of one Workspace in plan, lane, then completion order.

`KanbanCreateRequest` appends a draft. `KanbanEditRequest` replaces the text of an unsent or failed task. `KanbanMoveRequest` moves a draft, waiting, or failed task to a `KanbanMoveTarget`: a plan position or the end of one lane of the same Workspace. `KanbanTaskRequest` addresses a retry, skip, or deletion, and `KanbanDeleteResult` confirms a deletion. Running tasks reject edits, moves, and deletion.

## Dispatch

A lane sends its first waiting task when it has no running, attention, or failed task and its Agent is idle. The message is an ordinary user-role message with producer kind `kanban`; the Turn that claims it settles the task. A failed task pauses its lane until it is retried, skipped, or moved. Pending approval and user-question requests mark the running task `attention` after the configured delay.

## Design rationale

The [Kanban dispatch decision](../../.agents/notes/implemented/architecture/2026-10-08-experimental-kanban-dispatch.md) explains Host-side dispatch, Turn-claim settlement, and why lane tasks stay outside the Session inbox until sent.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxkanban--kanbanservice"></a>

### `ctx.kanban` — `KanbanService`

Kanban boards with a serialized write queue. Reads never resume a Session; dispatch resumes a lane's Session through the Session Controller.

```ts cordis-catalog
/**
 * Read one Workspace board without resuming any Session.
 * @param workspaceId - Workspace whose tasks are read.
 * @returns every task of the Workspace in board order.
 */
@Remote('board') async board(workspaceId: WorkspaceId): Promise<KanbanBoard>

/**
 * Follow one Workspace board: the current board first, then the complete
 * board after every committed change. Changes that land while an item is
 * unconsumed coalesce into the next item.
 * @param workspaceId - Workspace whose tasks are followed.
 * @param signal - Client observation lifetime.
 * @returns complete board snapshots.
 */
@Remote({ mode: 'stream' }) async *follow(workspaceId: WorkspaceId, signal: AbortSignal): AsyncIterable<KanbanBoard>

/**
 * Add one task at the end of a Workspace's plan pool.
 * @param request - Workspace, title, and instruction.
 * @returns the stored task.
 */
@Remote('create') async create(request: KanbanCreateRequest): Promise<KanbanTask>

/**
 * Replace the title and instruction of a draft, waiting, or failed task.
 * @param request - task identity and replacement text.
 * @returns the stored task.
 */
@Remote('edit') async edit(request: KanbanEditRequest): Promise<KanbanTask>

/**
 * Move a draft, waiting, or failed task within the plan pool, back to it,
 * or to the end of a lane. A task moved to a lane is sent when the lane reaches it.
 * @param request - task identity and target.
 * @returns the stored task.
 */
@Remote('move') async move(request: KanbanMoveRequest): Promise<KanbanTask>

/**
 * Requeue a failed task at the head of its lane.
 * @param request - failed task identity.
 * @returns the stored task.
 */
@Remote('retry') async retry(request: KanbanTaskRequest): Promise<KanbanTask>

/**
 * Move a failed task to the completed column without rerunning it; the lane resumes.
 * @param request - failed task identity.
 * @returns the stored task.
 */
@Remote('skip') async skip(request: KanbanTaskRequest): Promise<KanbanTask>

/**
 * Delete a task that is not running.
 * @param request - task identity.
 * @returns the deleted identity.
 */
@Remote('delete') async delete(request: KanbanTaskRequest): Promise<KanbanDeleteResult>
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/experimental/kanban/src/index.ts`](../../packages/experimental/kanban/src/index.ts)
<!-- END GENERATED cordis-surface -->

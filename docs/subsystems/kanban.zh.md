# 看板

[English](kanban.md) | 中文

实验性看板按工作区规划任务，并把任务逐个发送给会话。[Host 服务](../../packages/experimental/kanban/README.zh.md)负责存储和调度，[会话视图](../../packages/experimental/client-ui-kanban/README.zh.md)编辑和移动任务，[可选 Bundle](../../packages/experimental/kanban-bundle/README.zh.md) 同时启用两者。

## 任务与泳道

`KanbanTaskId` 是任务的品牌标识。`KanbanTask` 记录所属工作区、标题、说明、`KanbanTaskStatus`、泳道 `sessionId` 和 `rank`。`draft` 任务位于计划池；`waiting`、`running`、`attention` 和 `failed` 任务位于其会话的泳道；`done` 和 `skipped` 任务已结束。失败的任务带有 `KanbanFailure`，其 `KanbanFailureReason` 标明 Turn 的结束原因、重启（`interrupted`）、排队消息被移除（`discarded`）或发送失败（`dispatch`）。`KanbanBoard` 是一个工作区按计划池、泳道、已完成顺序排列的完整任务集。

`KanbanCreateRequest` 追加一个草稿。`KanbanEditRequest` 替换未发送或失败任务的文本。`KanbanMoveRequest` 把草稿、等待中或失败的任务移到 `KanbanMoveTarget`：计划池中的某个位置，或同一工作区某条泳道的末尾。`KanbanTaskRequest` 指定重试、跳过或删除的任务，`KanbanDeleteResult` 确认删除。执行中的任务拒绝编辑、移动和删除。

## 调度

当泳道中没有执行中、需要处理或失败的任务，且其 Agent 空闲时，泳道发送第一个等待中的任务。消息是一条生产者类型为 `kanban` 的普通 user 角色消息；认领该消息的 Turn 结算任务。失败的任务会暂停其泳道，直到被重试、跳过或移走。等待中的审批和用户提问请求超过配置的延迟后，执行中的任务标记为 `attention`。

## 设计理由

[看板调度决策](../../.agents/notes/implemented/architecture/2026-10-08-experimental-kanban-dispatch.zh.md)说明了为何在 Host 端调度、为何以 Turn 认领结算，以及为何泳道任务在发送前不进入会话 inbox。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [WorkspaceId](workspace.zh.md)

Source: [`packages/experimental/kanban/src/index.ts`](../../packages/experimental/kanban/src/index.ts)
<!-- END GENERATED cordis-surface -->

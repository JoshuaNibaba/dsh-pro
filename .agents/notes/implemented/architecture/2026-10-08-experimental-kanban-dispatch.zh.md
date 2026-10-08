# Agent Note：由认领 Turn 结算的 Host 端看板调度

Status: implemented

[English](2026-10-08-experimental-kanban-dispatch.md) | 中文

## 问题

看板让用户规划任务，并把任务排到会话泳道上，使会话无人值守地逐个处理。看板需要知道每个任务何时完成，必须在没有打开浏览器时继续发送，并且必须允许用户撤回或调整尚未开始的任务。会话等待人工审批或回答时，任务也需要可见的状态。

## 决策

Host 服务 `@deepseek-ai/dsh-experimental-kanban` 负责任务存储和调度。泳道把未发送的任务保存在 `kanban` 存储域中，而不是会话 inbox 中，并且仅在泳道没有未结算的任务且其 Agent 空闲时发送一个任务。因此，未发送的任务可以编辑、在泳道之间移动和撤回，而不改变会话 inbox 或 agent loop。

认领任务消息的 Turn 结算该任务：`agent/inbox/claimed` 记录认领的 Turn，该 Turn 的 `turn/end` 原因决定任务是 `done` 还是 `failed`。失败的任务会暂停其泳道，因此后续任务不会在意外结果之上继续执行。前置在 `approval/request` 和 `user-questions/request` waterfall 上的透传监听器统计等待中的人工请求，并且仅在可配置的延迟后把执行中的任务标记为 `attention`，因此由自动应答者处理的请求不会改变卡片颜色。

浏览器插件自行挂载生成的 Remote contribution，并通过一个 `follow` 流读取完整看板，因此稳定的 `api-remotes` 组装不依赖实验性包。

## 考虑过的替代方案

用 `followup()` 把每个泳道任务都排进会话 inbox 可以复用现有队列，但这会把排序和撤回交给 inbox，无法在失败后暂停，并且失去任务与 Turn 的对应关系。在浏览器中调度会在页面关闭时停止流水线。仅凭下一次空闲转换判断完成，会把任务发送前已开始的 Turn 误算为该任务；记录认领的 Turn 消除了这种情况。

## 影响

任务的 Turn 执行期间用户发送的消息会并入该 Turn，该 Turn 的结果计入该任务。执行中任务的信息保存在内存中，因此 Host 重启会把执行中的任务标记为 `interrupted`，而不是与会话日志对账。任务排入泳道后不能调整顺序。

验证覆盖纯看板转换、真实 agent-loop 调度、失败暂停、重试与跳过、`attention` 标记、归档撤回、重启恢复、会话视图标签，以及一个把任务拖到泳道并观察其完成的组装 Web 场景。

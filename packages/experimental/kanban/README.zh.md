---
description: "按工作区划分的看板，Host 调度器把排队任务逐个发送到对应的会话泳道。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-kanban

[English](README.md) | 中文

## 概述

此实验性 Host 服务为每个工作区保存一个看板，并把用户排在某个会话泳道上的任务逐个发送给该会话，每个任务占一个 Turn。认领任务消息的 Turn 以 `completed` 结束时任务完成；其他结束原因使任务失败并暂停该泳道，直到用户重试、跳过或撤回该任务。浏览器页面位于 [client-ui-kanban](../client-ui-kanban/README.zh.md)，[kanban-bundle](../kanban-bundle/README.zh.md) 负责同时启用两者。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在插件管理页启用看板 Bundle。每个任务有标题和可选说明，位于三处之一：计划池（`draft`）、会话泳道（`waiting`、`running`、`attention`、`failed`）或已完成列（`done`、`skipped`）。计划池中的任务可以编辑、排序和删除。把任务移到泳道会追加到泳道末尾；当泳道中没有执行中、需要处理或失败的任务，且会话的 Agent 空闲时，泳道发送第一个等待中的任务。等待中和失败的任务可以移回计划池，或移到同一工作区的其他泳道。执行中的任务所在会话有审批或提问请求等待超过 `attentionDelayMs` 时，任务显示 `attention`。归档会话会把其等待中的任务放回计划池。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `maxTitleChars` | `200` | 标题的最大长度（UTF-16 码元） |
| `maxPromptChars` | `20000` | 说明文字的最大长度 |
| `attentionDelayMs` | `500` | 人工请求等待多久后为执行中的任务改色 |

`kanban` Remote namespace 提供 `board`、`follow`（完整看板的流）、`create`、`edit`、`move`、`retry`、`skip` 和 `delete`。失败使用 `kanban/not-found`、`kanban/invalid-state`、`kanban/invalid-input`、`kanban/session-outside-workspace` 和 `workspace/not-found`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

任务以任务 id 为键存放在 `kanban` 存储域中；读取不会恢复会话。所有写入在同一个串行队列上执行。[`src/board.ts`](src/board.ts) 中的纯函数计算要写入的行，服务在每次持久写入后通知 `follow` 流。调度器在涉及泳道的写入后、泳道 Agent 变为空闲后、任务结束后以及启动时检查泳道。它通过 Session Controller 解析会话，把任务标记为 `running`，以生产者类型 `kanban` 调用 `Agent.followup()`，并刷新会话持久化。`agent/inbox/claimed` 记录认领该消息的 Turn；该 Turn 的 `turn/end` 结算任务，`agent/inbox/discarded` 使任务失败。前置的透传监听器在 `approval/request` 和 `user-questions/request` 上按会话统计等待中的人工请求。执行中任务的信息只保存在内存中，因此启动时会把上个进程遗留为 `running` 或 `attention` 的任务以原因 `interrupted` 标记为失败。由于存储的行是任务状态的唯一观测来源，此包不发布运行时不变量伴随模块。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [client-ui-kanban](../client-ui-kanban/README.zh.md) — 看板页面。
- [kanban-bundle](../kanban-bundle/README.zh.md) — 可选 Bundle。
- [添加 Remote API](../../../docs/cookbook/adding-a-remote-api.zh.md) — 此 namespace 遵循的 Remote 约定。

-----

<a id="model-experience"></a>
## 模型体验

### 已发送的任务

#### 模型看到的内容

每个发送的任务以一条生产者类型为 `kanban` 的 user 角色消息进入会话。文本为任务标题；说明非空白时，后接一个空行和说明。不附加任何框架文字、任务 id 或看板状态。

#### Token 影响

每个发送的任务作为普通用户消息，一次性增加其标题和说明的 token。

#### KV 缓存影响

消息追加到对话历史，不改写之前对模型可见的内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 泳道只在 Agent 空闲时发送任务，并由认领消息的 Turn 决定结果。用户在该 Turn 期间发送的消息会并入同一个 Turn，其结果也计入该任务。
- 同一泳道中等待的任务不能调整顺序；如需改变位置，请撤回后重新加入。
- Host 重启会把所有执行中的任务以 `interrupted` 标记为失败，而不是与会话日志对账。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>

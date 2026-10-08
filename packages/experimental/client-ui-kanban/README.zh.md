---
description: "按工作区展示的 Web 看板：计划池、可折叠的会话泳道和已完成列。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-kanban

[English](README.md) | 中文

## 概述

此可选浏览器插件在每个已开始会话的“对话”“轨迹”旁添加**任务看板**视图标签。该标签以三列展示会话所在工作区的看板：计划池、每个会话一条可折叠的泳道，以及已完成的任务。任务状态、排序和调度由[看板服务](../kanban/README.zh.md)负责。

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

在插件管理页启用[看板 Bundle](../kanban-bundle/README.zh.md)，然后在已开始会话顶部“对话”“轨迹”标签旁点击**任务看板**；输入框仍保留在看板下方。该标签始终显示会话所在工作区的看板。计划列中的**新建任务**打开编辑框，填写标题和可选说明。把计划卡片拖到另一张计划卡片上会放到该卡片之前；拖到泳道上会在该会话中排队；把排队中或失败的卡片拖回计划列即可撤回。执行列中的**新建会话**在工作区中创建一个空会话，并显示为新的泳道。每条泳道的标题栏可以折叠泳道或打开对应会话。没有任务的泳道默认折叠，除非会话正在运行；手动折叠状态保存在当前浏览器中。

卡片颜色随任务状态变化：草稿和排队中为灰色，执行中为蓝色，会话等待审批或回答时为橙色，失败为红色，完成为绿色。失败的卡片会暂停所在泳道，并提供重试、跳过和撤回计划池；已完成的卡片可以打开对应会话。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

浏览器入口自行挂载生成的 `kanban` Remote contribution，而不是扩展稳定的 `api-remotes` 组装，然后在“对话”“轨迹”之后注册 `conversation.view` 条目 `kanban`。该视图选中其会话所在的工作区；一个看板镜像仅在有视图订阅期间通过 `kanban.follow` 跟随该工作区，并在工作区变化时重新打开。工作区和会话数据来自标准的 `useWorkspaces` 与 `useSessions`；已归档和子代理会话不显示泳道。视图 store 把所选工作区和折叠状态保存在 local storage 中。拖放使用原生 HTML 拖拽事件和私有的数据类型。由于视图除了 Host 看板和浏览器本地的视图选择外不持有状态，此包不发布运行时不变量伴随模块。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [看板服务](../kanban/README.zh.md) — 任务存储、调度和 Remote namespace。
- [看板 Bundle](../kanban-bundle/README.zh.md) — 可选 Bundle。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：看板服务把每个排队任务作为用户消息发送给对应会话。

#### KV 缓存影响

视图本身不向请求添加内容；发送的消息由看板服务负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 拖动需要指针设备；键盘用户只能通过“撤回计划池”移动卡片。
- 泳道内排队的卡片不能调整顺序。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>

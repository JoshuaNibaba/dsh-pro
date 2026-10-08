---
description: "从插件管理页添加看板任务面板及其会话调度器。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-kanban-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 插入已发布 Web 组合中没有的两行看板配置：`kanban` 和 `ui-kanban`。已发布的 profile 默认不启用它。

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

在 Web 侧栏打开插件管理页，启用带三列图标的“看板”。侧栏随后出现看板入口，页面按工作区规划任务，并把任务排到会话泳道上；[页面 README](../client-ui-kanban/README.zh.md) 介绍看板，[服务 README](../kanban/README.zh.md) 介绍调度规则。停用 Bundle 会停止调度；已保存的任务仍保留在磁盘上。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`cordis.patch.yml` 插入这两行，`package.json` 依赖对应的包，使每一行都能从此 Bundle 解析。`packages/boot/app-boot/src/profile.ts` 中的 `OPTIONAL_BUNDLES` 列出此包，且 `apps/cli` 依赖它，因此每个安装都附带此 Bundle 且默认关闭，插件管理页在官方分组中提供它。由于此包只含配置、不持有可变运行时状态，不发布运行时不变量伴随模块。

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 插入 `kanban` 和 `ui-kanban` 两行 |
| [`package.json`](package.json) | 把各行对应的包声明为依赖 |
| [`locale/en.json`](locale/en.json)、[`locale/zh.json`](locale/zh.json) | 插件管理页的标题和描述 |
| [`icon.svg`](icon.svg) | 插件管理页图标 |
| [`src/index.ts`](src/index.ts) | 空模块入口；运行时内容就是 patch |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [看板服务](../kanban/README.zh.md) — 存储、调度和 Remote namespace。
- [看板页面](../client-ui-kanban/README.zh.md) — 浏览器看板。

-----

<a id="model-experience"></a>
## 模型体验

### 已发送的任务

#### 模型看到的内容

每个排队任务以一条生产者类型为 `kanban` 的 user 角色消息到达对应会话，内容为任务标题；有说明时，在空行后附上说明。

#### Token 影响

启用 Bundle 不增加工具 schema 或提示词段落；每个发送的任务一次性增加其自身文本。

#### KV 缓存影响

发送的任务追加到对话历史，不改变请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Bundle 启用期间，其页面为每一行提供开关。两行必须同时启用：关闭 `kanban` 会使页面失去其 Remote namespace。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>

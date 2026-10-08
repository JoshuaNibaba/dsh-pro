---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-08-kanban-message-source

[English](2026-10-08-kanban-message-source.md) | 中文

## 概述

为实验性看板服务发送给会话的任务新增仅用于归属的消息来源类型 `kanban`。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-kanban-message-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "c183b6d002aecfd9bbf4469041b0b329210d8750196242c2ed5ff19ef22ba557"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "9be04720cb56924983c42087e8caafd191d22b959e304c712f516ff57376e935"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "a7f17f03a214b71bd063d5a6f712b57b22a9abe4a83323a561452ced3aff2929"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "b7c5f43e6e6e962601fa9bc3542d706da61f037118f908ea145dd3cb7bd49d09"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效。该类型除 `kind` 外不带任何字段；未安装看板包的读取方把消息保留为普通 user 角色消息，看板服务只匹配当前进程中自己发送的消息 id。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/kanban：27 个测试通过，其中包括真实 agent-loop 调度，并记录来源类型为 kanban 的 user/message。

<a id="dev-note"></a>
## 开发备注

无。

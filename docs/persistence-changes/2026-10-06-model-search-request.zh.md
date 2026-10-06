---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-06-model-search-request

[English](2026-10-06-model-search-request.md) | 中文

## 概述

新增仅记录日志的 web/model-search-request 事件，记录 model-native 网页搜索提供方发出的原生搜索辅助模型请求。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-06-model-search-request
baseline: false
changes:
  - root: "event:web/model-search-request"
    previous: null
    after: "63534f82de9c65fdde2766efcc791b59851e13bd3916dc930899172d900e770b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增普通的仅日志事件类型不需要升级格式版本。已有日志不包含它；重建、消息派生和 surface 都忽略它，因此旧记录保持有效，新记录只多一条审计条目。

<a id="verification"></a>
## 验证

vitest run packages/web/web-search-model/tests/model.spec.ts 和 packages/llm/llm-pi-ai/tests/web-search.spec.ts：22 个测试通过，包括一次搜索写入的事件载荷。

<a id="dev-note"></a>
## 开发备注

无。

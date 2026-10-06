---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-06-model-search-request

English | [中文](2026-10-06-model-search-request.zh.md)

## Summary

Adds the log-only web/model-search-request event that records the auxiliary native-search model request of the model-native web search provider.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Adding an ordinary log-only event type needs no format bump. Existing logs never contain it; reconstruction, message derivation, and the surface ignore it, so older records stay valid and new records only add an audit entry.

<a id="verification"></a>
## Verification

vitest run packages/web/web-search-model/tests/model.spec.ts and packages/llm/llm-pi-ai/tests/web-search.spec.ts: 22 tests passed, including the event payload written for one search.

<a id="dev-note"></a>
## Dev Note

None.

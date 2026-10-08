---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-08-kanban-message-source

English | [中文](2026-10-08-kanban-message-source.zh.md)

## Summary

Adds the attribution-only message source kind `kanban` for tasks the experimental Kanban service sends to Sessions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records remain valid. The kind carries no fields beyond `kind`; readers without the Kanban package preserve the message as an ordinary user-role message, and the Kanban service matches only the message id it sent in the current process.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/kanban: 27 tests passed, including real agent-loop dispatch that records a user/message with source kind kanban.

<a id="dev-note"></a>
## Dev Note

None.

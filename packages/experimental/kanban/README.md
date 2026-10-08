---
description: "Per-Workspace Kanban boards whose Host dispatcher sends queued tasks to their Session lanes one at a time."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-kanban

English | [中文](README.zh.md)

## Summary

This experimental Host service stores one Kanban board per Workspace and sends the tasks a user queues on a Session lane to that Session, one task per Turn. A task completes when the Turn that claimed its message ends with `completed`; any other end fails the task and pauses its lane until the user retries, skips, or withdraws it. The browser page lives in [client-ui-kanban](../client-ui-kanban/README.md), and the [kanban-bundle](../kanban-bundle/README.md) switches both on.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable the Kanban bundle from Plugins. Each task has a title and optional details and lives in one of three places: the plan pool (`draft`), a Session lane (`waiting`, `running`, `attention`, `failed`), or the completed column (`done`, `skipped`). Plan-pool tasks can be edited, reordered, and deleted. Moving a task onto a lane appends it to the lane; the lane sends its first waiting task when no task of the lane is running, needs attention, or has failed, and the Session's Agent is idle. Waiting and failed tasks can move back to the plan pool or to another lane of the same Workspace. A running task shows `attention` while an approval or user-question request in its Session stays pending longer than `attentionDelayMs`. Archiving a Session returns its waiting tasks to the plan pool.

| Config | Default | Meaning |
|---|---|---|
| `maxTitleChars` | `200` | Longest accepted title in UTF-16 code units |
| `maxPromptChars` | `20000` | Longest accepted details text |
| `attentionDelayMs` | `500` | Pending time before a human request recolors the running task |

The `kanban` Remote namespace exposes `board`, `follow` (a stream of complete boards), `create`, `edit`, `move`, `retry`, `skip`, and `delete`. Failures use `kanban/not-found`, `kanban/invalid-state`, `kanban/invalid-input`, `kanban/session-outside-workspace`, and `workspace/not-found`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

Tasks live in the `kanban` storage domain keyed by task id; reads never resume a Session. Every write runs on one serialized queue. Pure transitions in [`src/board.ts`](src/board.ts) compute the rows to write, and the service notifies `follow` streams after each durable write. The dispatcher drives a lane after a write that touches it, after its Agent turns idle, after a task settles, and at startup. It resolves the Session through the Session Controller, marks the task `running`, calls `Agent.followup()` with producer kind `kanban`, and flushes Session persistence. `agent/inbox/claimed` records the Turn that claimed the message; that Turn's `turn/end` settles the task, and `agent/inbox/discarded` fails it. Prepended pass-through listeners on `approval/request` and `user-questions/request` count pending human requests per Session. Running-task facts stay in memory, so startup fails every task a previous process left `running` or `attention` with reason `interrupted`. No runtime invariant companion is published because the stored rows are the only observation of task state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [client-ui-kanban](../client-ui-kanban/README.md) — the board page.
- [kanban-bundle](../kanban-bundle/README.md) — the optional bundle.
- [Adding a Remote API](../../../docs/cookbook/adding-a-remote-api.md) — the Remote conventions this namespace follows.

-----

<a id="model-experience"></a>
## Model Experience

### Sent tasks

#### What the model sees

Each sent task enters its Session as one user-role message with producer kind `kanban`. The text is the task title, followed by a blank line and the details when the details are not blank. No framing, task id, or board state is added.

#### Token effect

Each sent task adds the tokens of its title and details once, as an ordinary user message.

#### KV Cache effect

The message appends to conversation history and does not rewrite earlier model-visible content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A lane sends only while its Agent is idle, and the claiming Turn decides the outcome. A message the user sends during that Turn joins it, so its result counts toward the task.
- Waiting tasks in one lane cannot be reordered; withdraw and re-add a task to change its position.
- A Host restart fails every running task with `interrupted` instead of reconciling it with the Session log.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>

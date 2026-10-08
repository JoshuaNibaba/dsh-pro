---
description: "Add the Kanban task board and its Session dispatcher from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-kanban-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle inserts the two Kanban rows the shipped Web composition leaves out: `kanban` and `ui-kanban`. Shipped profiles leave it switched off.

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

Open Plugins in the Web sidebar and enable Kanban, marked by a three-column icon. Every started Session then gains a **Kanban board** tab beside Chat and Trajectory that plans tasks for the Session's Workspace and queues them on Session lanes; the [View README](../client-ui-kanban/README.md) describes the board and the [service README](../kanban/README.md) the dispatch rules. Disabling the bundle stops dispatch; stored tasks remain on disk.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`cordis.patch.yml` inserts the two rows, and `package.json` depends on their packages so each row resolves from this bundle. `OPTIONAL_BUNDLES` in `packages/boot/app-boot/src/profile.ts` names this package and `apps/cli` depends on it, so every installation ships it switched off and the plugin manager offers it in the Official group. No runtime invariant companion is published because this configuration-only package owns no mutable runtime state.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Inserts the `kanban` and `ui-kanban` rows |
| [`package.json`](package.json) | The row packages as dependencies |
| [`locale/en.json`](locale/en.json), [`locale/zh.json`](locale/zh.json) | Plugin-manager title and description |
| [`icon.svg`](icon.svg) | Plugin-manager icon |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Kanban service](../kanban/README.md) — storage, dispatch, and the Remote namespace.
- [Kanban View](../client-ui-kanban/README.md) — the browser board.

-----

<a id="model-experience"></a>
## Model Experience

### Sent tasks

#### What the model sees

Each queued task reaches its Session as one user-role message with producer kind `kanban`, containing the task title and, when present, its details after a blank line.

#### Token effect

Selecting the bundle adds no tool schemas or prompt sections; each sent task adds its own text once.

#### KV Cache effect

Sent tasks append to conversation history and do not change the request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- While the bundle is on, its page offers a switch per row. The two rows work only together: switching `kanban` off leaves the View without its Remote namespace.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>

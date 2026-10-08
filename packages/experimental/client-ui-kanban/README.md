---
description: "Web Kanban board with a plan pool, collapsible Session lanes, and a completed column per Workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-kanban

English | [中文](README.zh.md)

## Summary

This optional browser plugin adds a Kanban entry to the sidebar. The page shows one Workspace's board in three columns: the plan pool, one collapsible lane per Session, and completed tasks. Task state, ordering, and dispatch belong to the [Kanban service](../kanban/README.md).

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

Enable the [Kanban bundle](../kanban-bundle/README.md) from Plugins, then select Kanban in the sidebar, or select **Kanban board** beside the Chat and Trajectory tabs of a Session to open the board of that Session's Workspace. The Workspace button in the header switches boards. **New task** in the plan column opens an editor for a title and optional details. Drag a plan card onto another plan card to place it before that card, onto a lane to queue it in that Session, or back onto the plan column to withdraw a queued or failed card. **New session** in the run column creates an empty Session in the Workspace; it appears as a new lane. Each lane header folds the lane and opens its Session. Lanes without tasks start folded unless the Session is running; the selected Workspace and explicit folding are kept in this browser.

Card colors follow task state: grey for drafts and queued tasks, blue for running tasks, orange when the Session waits for an approval or answer, red for failures, and green for completed tasks. A failed card pauses its lane and offers Retry, Skip, and Back to plan; completed cards open their Session.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The browser entry mounts the generated `kanban` Remote contribution itself instead of extending the stable `api-remotes` assembly, then registers the `main` page, the `sidebar.panellist` entry, and a `conversation.session.header.links` entry that selects the Session's Workspace and the board panel. One board mirror follows the selected Workspace through `kanban.follow` only while the page subscribes, and reopens when the selection changes. Workspace and Session rows come from the standard `useWorkspaces` and `useSessions` seats; archived and subagent Sessions get no lane. The view store persists the selection and folding in local storage. Drag and drop uses native HTML drag events with a private payload type. No runtime invariant companion is published because the page holds no state beyond the Host board and browser-local view choices.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Kanban service](../kanban/README.md) — task storage, dispatch, and the Remote namespace.
- [Kanban bundle](../kanban-bundle/README.md) — the optional bundle.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Kanban service, which sends each queued task to its Session as a user message.

#### KV Cache effect

The page contributes no request content; the Kanban service owns the sent messages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Dragging requires a pointer; keyboard users move cards with Back to plan only.
- Queued cards inside a lane cannot be reordered.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>

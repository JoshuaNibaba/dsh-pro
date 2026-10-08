# Agent Note: Host-side Kanban dispatch settled by the claiming Turn

Status: implemented

English | [中文](2026-10-08-experimental-kanban-dispatch.zh.md)

## Problem

A Kanban board lets a user plan tasks and queue them on Session lanes so the Sessions work through them unattended. The board needs to know when each task is finished, must keep sending while no browser is open, and must let the user withdraw or reorder work that has not started. Each task also needs a visible state when the Session waits for a human approval or answer.

## Decision

The Host service `@deepseek-ai/dsh-experimental-kanban` owns task storage and dispatch. A lane keeps its unsent tasks in the `kanban` storage domain, not in the Session inbox, and sends exactly one task when the lane has no unsettled task and its Agent is idle. Unsent tasks therefore stay editable, movable between lanes, and withdrawable without changing the Session inbox or the agent loop.

The Turn that claims the task's message settles the task: `agent/inbox/claimed` records the claiming Turn, and that Turn's `turn/end` reason decides between `done` and `failed`. A failed task pauses its lane, so later tasks never run on top of an unexpected result. Pass-through listeners prepended to the `approval/request` and `user-questions/request` waterfalls count pending human requests and mark the running task `attention` only after a configurable delay, so requests an automatic answerer settles do not recolor the card.

The browser plugin mounts its generated Remote contribution itself and reads complete boards through one `follow` stream, so the stable `api-remotes` assembly takes no experimental dependency.

## Alternatives considered

Queuing every lane task in the Session inbox with `followup()` reuses the existing queue, but it hands ordering and withdrawal to the inbox, cannot pause after a failure, and loses the task-to-Turn association. Running dispatch in the browser would stop the pipeline when the page closes. Correlating completion by waiting for the next idle transition alone misattributes a Turn that started before the task was sent; recording the claiming Turn removes that case.

## Consequences

A message the user sends while a task's Turn runs joins that Turn, and the Turn's outcome counts for the task. Running-task facts live in memory, so a Host restart marks running tasks `interrupted` instead of reconciling them with the Session log. Lane tasks cannot be reordered after they are queued.

Verification covers the pure board transitions, real agent-loop dispatch, failure pause, retry and skip, attention marking, archive withdrawal, restart recovery, the browser page, and an assembled Web scenario that drags a task onto a lane and observes it completed.

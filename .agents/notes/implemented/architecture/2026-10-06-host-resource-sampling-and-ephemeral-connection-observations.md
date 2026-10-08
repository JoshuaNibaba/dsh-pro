# Agent Note: Host resource sampling and ephemeral connection observations

Status: implemented

English | [中文](2026-10-06-host-resource-sampling-and-ephemeral-connection-observations.zh.md)

## Problem

The conversation footer needs current server load and connection availability beside durable session statistics. CPU, available memory and RPC latency describe a running Host and one browser connection; attaching them to a Session would give unrelated sessions separate samplers and preserve readings after their source disappears.

## Decision

The [server-status plugin](../../../../packages/client/ui-server-status/README.md) owns one operating-system sampler per Host plugin activation and exposes its latest numeric readings through authenticated Connection RPC. Sampling is independent of the number of browser pages and selected Sessions. Caller-fiber ownership makes the RPC route and sampler leave with the plugin rather than the Connection provider.

Each Client activation owns one nonoverlapping polling loop and a private observable for the latest resource readings and measured RPC round-trip time. Connection state comes from the existing Connection service. Disconnect, request failure and timeout clear observations; reconnect starts a fresh measurement, and disposal aborts and awaits the pending request. These observations do not enter Session events, session projections, model requests or durable GUI stores.

The plugin contributes its display through the conversation dock slot. The shipped Web roster includes the package with activation disabled, so a profile chooses whether to sample and display these values. The [Session observation decision](2026-08-25-session-observations-and-projection-owned-client-state.md) continues to own replayable Session facts, and the [token-usage decision](2026-07-29-projected-token-usage-and-request-context.md) continues to own durable billing and context occupancy.

## Alternatives considered

**Persist readings as Session events or projections.** This would preserve historical measurements and add replayable data, but current server load and one browser's network timing are independent of Session history. Polling would grow logs and duplicate values across Sessions without improving the current-status display.

**Sample inside each RPC request.** This would avoid a Host timer, but CPU utilization requires an interval between counter reads. Independent browser requests would establish different intervals and multiply operating-system reads. A shared sampler gives every caller the same current interval.

## Consequences

The display adds no model tokens and does not change request prefixes. Resource sampling survives Session switches while Client readings disappear with their page or plugin. Independent browser pages still make independent RPC requests, so latency describes the requesting page rather than a server-wide network measurement.

Focused sampler and poller tests cover unavailable first samples, failed reads, nonoverlapping requests and disposal. Real Loader HTTP tests cover authentication, caller-owned registrations and route removal. Presentation snapshots cover available and unavailable readings without adding telemetry to recorded Sessions.

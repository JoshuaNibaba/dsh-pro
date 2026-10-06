---
description: "Server CPU, memory, connection state and measured round-trip latency in the conversation composer dock."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-server-status

English | [中文](README.zh.md)

## Summary

Display server-wide CPU usage, Linux memory used/total, browser connection state and measured RPC round-trip time after conversation statistics. Readings refresh while connected and clear when requests fail. Choose this package to check current server load and connection availability without opening a separate monitor. Memory readings require Linux. See the [Web Client subsystem](../../../docs/subsystems/web-client.md) for the surrounding GUI.

## Table of Contents

- [Configuration](#configuration)
- [Readings and lifecycle](#readings-and-lifecycle)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="configuration"></a>
## Configuration

Mount this package in a Web profile alongside WebServer, Connection, Locale and the conversation dock owner. Configure its Host row in YAML; Host settings enter the standard `webserver/index-inject` boot payload as `__DSH_SERVER_STATUS_CONFIG__`, and the browser validates that payload before polling. Reload the browser page after changing settings.

```yaml
- name: '@deepseek-ai/dsh-client-ui-server-status'
  config:
    sampleIntervalMs: 3000
    requestTimeoutMs: 5000
```

| Field | Default | Accepted values and behavior |
|---|---|---|
| `sampleIntervalMs` | `3000` | Integer milliseconds, 250–3600000; Host sampling interval and Client delay after each settled request. |
| `requestTimeoutMs` | `5000` | Integer milliseconds, 100–300000; Client deadline before readings clear and the RPC aborts. |

Invalid configuration rejects plugin activation. A standalone Client Loader without a Host boot payload uses its explicitly resolved Loader configuration.

<a id="readings-and-lifecycle"></a>
## Readings and lifecycle

CPU percentage covers all server CPUs. The first sample, CPU count changes or failed CPU reads report unavailable. Linux memory used equals `MemTotal - MemAvailable`, so reclaimable memory remains available; failed or malformed memory reads report unavailable independently of CPU.

The display maps Connection's `connecting` state to Reconnecting and preserves Connected when an RPC fails. CPU and memory use one decimal place; memory uses GiB. Round-trip latency measures the actual snapshot RPC, including transport and response handling, and rounds milliseconds to an integer.

Disconnect, failure or timeout clears readings. Reconnect starts a fresh request after any aborted request settles. Disposal removes the display and awaits the pending request's settlement. The dock contribution appears after conversation statistics and wraps in narrow composers.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host shares one periodic sample across authenticated requests. Its `/server-status` RPC channel serves cached numeric readings at endpoint `snapshot`; unknown endpoints return `server-status/not-found`. The [sampler](src/sampler.ts) computes CPU utilization from differences in `os.cpus()` counters and reads Linux memory from `/proc/meminfo`.

The [poller](src/client/poller.ts) permits one request at a time, clears stale readings and rejects old-generation responses after connection changes. The pure presenter receives framework selector hooks for Connection state and private metric observations. Its slot registration waits for the dock declaration and leaves with the plugin fiber.

Host and Client use separate compiler faces because their Connection types differ. No runtime invariant companion is published because this package owns a sampler and its direct presentation, with no independently observed relation that can diverge; focused tests cover lifecycle behavior and wire validation.

</details>

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

<a id="model-experience"></a>
## Model Experience

### GUI readings

#### What the model sees

The model sees no readings: `/server-status` responses stay in the GUI and do not enter prompts, tools or session events.

#### Token effect

The plugin adds zero model-input or output tokens.

#### KV Cache effect

Polling and metric changes do not change the model request prefix or its cache eligibility.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The readings describe the current server and client connection with these limits:

- CPU describes operating-system aggregate counters, not the DSH process or a container CPU quota. Memory requires Linux and reflects `/proc/meminfo`, not a cgroup memory limit.
- The feature does not collect network-interface bandwidth, disk usage or historical metrics. Each browser page polls independently; the Host still samples once per interval.
- A transport that ignores abort delays reconnect polling and disposal until its request settles; the poller preserves its no-overlap guarantee.
- Browser timing settings update on page reload rather than live configuration replacement.

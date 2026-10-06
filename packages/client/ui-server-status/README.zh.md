---
description: "在对话输入框底栏显示服务器 CPU、内存、连接状态与实测往返延迟。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-server-status

[English](README.md) | 中文

## 概述

在对话统计之后显示服务器整体 CPU 使用率、Linux 内存已用量/总量、浏览器连接状态与实测 RPC 往返时间。连接期间读数持续刷新，请求失败时清除。选择本包可在不打开独立监控工具的情况下检查当前服务器负载与连接可用性。内存读数要求 Linux。GUI 的相关设计见 [Web Client 子系统](../../../docs/subsystems/web-client.zh.md)。

## 目录

- [配置](#configuration)
- [读数与生命周期](#readings-and-lifecycle)
- [了解实现](#understand-the-implementation)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="configuration"></a>
## 配置

在 Web 配置中与 WebServer、Connection、Locale 及对话底栏所有者一起挂载本包。在 YAML 中配置 Host 条目；Host 设置通过标准 `webserver/index-inject` 启动载荷中的 `__DSH_SERVER_STATUS_CONFIG__` 传递，浏览器在轮询前校验载荷。修改设置后重新加载浏览器页面。

```yaml
- name: '@deepseek-ai/dsh-client-ui-server-status'
  config:
    sampleIntervalMs: 3000
    requestTimeoutMs: 5000
```

| 字段 | 默认值 | 合法取值与行为 |
|---|---|---|
| `sampleIntervalMs` | `3000` | 整数毫秒，250–3600000；Host 采样间隔和 Client 每次请求结束后的等待时间。 |
| `requestTimeoutMs` | `5000` | 整数毫秒，100–300000；Client 在此期限后清除读数并中止 RPC。 |

非法配置会拒绝插件激活。没有 Host 启动载荷的独立 Client Loader 使用其显式解析后的 Loader 配置。

<a id="readings-and-lifecycle"></a>
## 读数与生命周期

CPU 百分比覆盖服务器全部 CPU。首次采样、CPU 数量变化或 CPU 读取失败时显示不可用。Linux 内存已用量为 `MemTotal - MemAvailable`，可回收内存仍计为可用；内存读取失败或格式错误时显示不可用，且不影响 CPU。

显示将 Connection 的 `connecting` 状态映射为重新连接中，RPC 失败时仍保留已连接状态。CPU 和内存保留一位小数；内存使用 GiB。往返延迟测量真实快照 RPC 的耗时，包含传输和响应处理，并将毫秒四舍五入为整数。

断连、失败或超时会清除读数。重新连接会在先前中止的请求结束后发起新请求。卸载会移除显示，并等待活动请求结束。底栏贡献位于对话统计之后，并在窄输入框内换行。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host 通过周期采样为所有已认证请求共享一份读数。其 `/server-status` RPC 通道在 `snapshot` 端点提供缓存的数值读数；未知端点返回 `server-status/not-found`。[采样器](src/sampler.ts) 根据 `os.cpus()` 计数器差值计算 CPU 使用率，并从 `/proc/meminfo` 读取 Linux 内存。

[轮询器](src/client/poller.ts) 同时只允许一个请求，清除过期读数，并在连接变化后拒绝旧代次响应。纯展示组件通过框架 selector hooks 接收 Connection 状态与私有指标观测。其 slot 注册等待底栏声明，并随插件 fiber 移除。

Host 和 Client 使用独立编译面，因为其 Connection 类型不同。本包不发布运行时 invariant companion，因为它拥有采样器及其直接展示，没有可能发生偏离的独立观测关系；定向测试覆盖生命周期行为与 wire 校验。

</details>

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验

### GUI 读数

#### 模型看到的内容

模型看不到读数：`/server-status` 响应仅存在于 GUI，不进入提示词、工具或会话事件。

#### Token 影响

插件不增加模型输入或输出 token。

#### KV Cache 影响

轮询和指标变化不会改变模型请求前缀或其缓存资格。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

读数描述当前服务器与客户端连接，并有以下限制：

- CPU 描述操作系统汇总计数器，不描述 DSH 进程或容器 CPU 配额。内存要求 Linux，反映 `/proc/meminfo` 而非 cgroup 内存限制。
- 本功能不收集网卡带宽、磁盘使用量或历史指标。每个浏览器页面独立轮询；Host 仍按每个间隔采样一次。
- 忽略中止信号的传输会延迟重新连接后的轮询及卸载，直到请求结束；轮询器保持请求不重叠的保证。
- 浏览器时序设置在页面重新加载时更新，不支持实时配置替换。

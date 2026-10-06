# Agent Note: Host resource sampling and ephemeral connection observations

Status: implemented

[English](2026-10-06-host-resource-sampling-and-ephemeral-connection-observations.md) | 中文

## 问题

会话页脚需要在持久化的会话统计旁显示当前服务器负载与连接可用性。CPU、可用内存和 RPC 延迟描述的是运行中的 Host 和单个浏览器连接；若将它们附着到 Session，无关会话就会拥有各自的采样器，并在数据来源消失后继续保留读数。

## 决策

[服务器状态插件](../../../../packages/client/ui-server-status/README.zh.md)在每次 Host 插件激活期间拥有一个操作系统采样器，通过已认证的 Connection RPC 提供最新数值。采样与浏览器页面数量及选中的 Session 无关。RPC 路由归调用方 fiber 所有，因此路由和采样器随插件卸载，而不随 Connection 提供方存续。

每次 Client 激活拥有一个不重叠的轮询循环，以及保存最新资源读数和实测 RPC 往返时间的私有可观察对象。连接状态来自现有 Connection 服务。断连、请求失败和超时清除观测值；重连开始新的测量，卸载则中止并等待未完成的请求。这些观测值不进入 Session 事件、会话投影、模型请求或持久化 GUI store。

插件通过会话 dock 插槽贡献显示项。随附的 Web 插件列表包含该包，但默认禁用，由 profile 决定是否采样和显示这些数值。[Session 观察决策](2026-08-25-session-observations-and-projection-owned-client-state.zh.md)继续负责可回放的 Session 事实，[token 用量决策](2026-07-29-projected-token-usage-and-request-context.zh.md)继续负责持久化的计费与上下文占用。

## 考虑过的替代方案

**将读数持久化为 Session 事件或投影。** 这样可以保留历史测量并增加可回放的数据，但当前服务器负载和单个浏览器的网络耗时独立于 Session 历史。轮询会增加日志长度并在多个 Session 中复制数值，却不能改善当前状态显示。

**在每次 RPC 请求内采样。** 这样可以省去 Host 定时器，但 CPU 利用率要求在两次计数器读取之间存在时间间隔。各浏览器的独立请求会形成不同的间隔，并增加操作系统读取次数。共享采样器为每个调用方提供同一个当前采样区间。

## 影响

显示项不增加模型 token，也不改变请求前缀。资源采样在切换 Session 时继续运行，Client 读数随页面或插件消失。独立的浏览器页面仍分别发送 RPC 请求，因此延迟描述的是发起请求的页面，而非服务器范围的网络测量。

定向采样器和轮询器测试覆盖首个样本不可用、读取失败、请求不重叠与卸载。真实 Loader HTTP 测试覆盖认证、调用方拥有的注册和路由移除。展示快照覆盖可用及不可用的读数，且不向已记录的 Session 添加遥测。

---
description: "ctx.web 的模型原生搜索提供方：用会话所在模型路由的服务端搜索工具搜索，做法与 Claude Code 的 WebSearch 相同。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-model

[English](README.md) | 中文

## 概要

有了 `dsh-web-search-model`，`web_search` 使用会话当前所用模型的搜索能力。每次搜索是在会话的提供方路由上发出的一次辅助模型请求，唯一的工具是该提供方的服务端搜索工具，与 Claude Code 的 WebSearch 工具发出的请求相同。Anthropic Messages 路由使用 `web_search_20250305`；OpenAI Responses、Azure Responses 和 ChatGPT Codex 路由使用 `web_search`。原生搜索由其他提供方承担的路由（如 DeepSeek）委托给它；其余路由直接失败。面向模型的 `web_search` 工具位于 `dsh-tool-web`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已加载 web 服务和 LLM 服务的组合中挂载本提供方，并用 `searchProvider: model-native` 固定它。随附的 base bundle 已这样配置，并把 DeepSeek 路由委托给 `deepseek-official`。

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: model-native
- name: '@deepseek-ai/dsh-web-search-model'
  config:
    models:
      anthropic: claude-haiku-4-5
    delegates:
      deepseek-official: deepseek-official
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `models` | `{}` | 每个提供方路由的搜索模型 id；未列出的路由使用会话当前模型搜索 |
| `delegates` | `{}` | 每个提供方路由的搜索提供方 id；委托给 `model-native` 自身会在加载时失败 |

### 一次搜索发送什么

请求与 Claude Code 一致：系统提示词 `You are an assistant for performing a web search tool use`，一条用户消息 `Perform a web search for the query: <query>`，且只带搜索工具。在 Anthropic 上强制使用该工具，`max_uses: 8`，并关闭思考；无法关闭思考的模型保留思考，工具选择改为自动。公开 Responses API 收到 `tool_choice: required` 并请求 `web_search_call.action.sources`；ChatGPT Codex 后端使用自动工具选择。路由的凭据、OAuth 登录、端点和请求头原样生效，每个请求都拒绝 HTTP 重定向。

### 一次搜索返回什么

提供方的说明文字和单次搜索错误（`Web search error: <code>`）按响应顺序成为 `content`；结果链接和 URL 引用去重后成为 `sources`，有标题时带标题。发出请求前，提供方向发起会话追加一条仅日志的 `web/model-search-request` 事件，记录路由、模型、协议和请求体。

### 失败

| 代码 | 原因 |
|---|---|
| `WEB_MODEL_ROUTE_UNKNOWN` | 没有发起会话，或会话还没有发出过模型请求 |
| `WEB_PROVIDER_UNSUPPORTED` | 路由的适配器或协议没有原生搜索，且没有配置委托 |
| `WEB_ABORTED` | 调用方取消了搜索 |
| `WEB_PROVIDER_ERROR` | 其他适配器、凭据、HTTP 或提供方失败 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

提供方从发起会话最近的 `request/context` 事件读取路由和模型，调用 `ctx.llm.webSearch()`，由它分派给拥有该路由的适配器的 `LlmAdapter.webSearch()`。基类适配器以 `UNSUPPORTED_WEB_SEARCH` 拒绝。`dsh-llm-pi-ai` 覆盖了它：通过路由的 pi-ai 集合流式发出辅助请求，在 `onPayload` 中挂上搜索工具，并由 `fetch` 包装器复制一份响应流来读取服务端工具事件，因为 pi-ai 的助手事件不包含服务端工具块。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、自委托检查、注册提供方 |
| [`src/provider.ts`](src/provider.ts) | `ModelNativeSearchProvider`、结果映射、错误映射、事件声明 |
| — | 不发布运行时不变量伴随包；提供方除配置外不持有状态。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-web](../web/README.zh.md) — 本提供方注册进的 web 服务。
- [dsh-tool-web](../tool-web/README.zh.md) — 面向模型的 `web_search` 工具。
- [dsh-web-search-deepseek](../web-search-deepseek/README.zh.md) — DeepSeek 路由委托的 DeepSeek 原生搜索。
- [dsh-llm-pi-ai](../../llm/llm-pi-ai/README.zh.md) — 为 pi-ai 路由实现原生搜索的适配器。

-----

<a id="model-experience"></a>
## 模型体验

间接体现，经由 `dsh-tool-web`：它把本提供方的说明文字渲染为回答文本、把链接渲染为来源，或在工具的错误包装下呈现失败消息。辅助搜索请求是单独的模型请求，不进入会话的请求历史。

#### KV Cache 影响

对会话没有影响；辅助请求不复用会话前缀的提示词缓存。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **不支持 Google、Bedrock 和 OpenAI 兼容的 Chat Completions 路由** — pi-ai 的 Google 适配器拒绝自定义 `fetch`，其他协议没有标准的服务端搜索工具。
- **不提供域名过滤** — `web_search` 工具没有 `allowed_domains`/`blocked_domains` 参数。
- **网关路由只有在网关转发服务端搜索工具时才能搜索。**

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>

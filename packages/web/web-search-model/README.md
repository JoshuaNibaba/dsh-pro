---
description: "The model-native search provider for ctx.web: searches with the server-side search tool of the conversation's own model route, as Claude Code's WebSearch does."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-model

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-model`, `web_search` uses the search capability of whichever model the conversation runs on. Each search is one auxiliary model request on the conversation's provider route whose only tool is that provider's server-side search tool, the same request Claude Code's WebSearch tool sends. Anthropic Messages routes use `web_search_20250305`; OpenAI Responses, Azure Responses, and ChatGPT Codex routes use `web_search`. Routes whose native search another provider serves, such as DeepSeek, delegate to it; every other route fails. The model-facing `web_search` tool lives in `dsh-tool-web`.

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

Mount the provider beside the web and LLM services and pin it with `searchProvider: model-native`. The shipped base bundle does this and delegates the DeepSeek routes to `deepseek-official`.

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

| Field | Default | Meaning |
|---|---|---|
| `models` | `{}` | Search model id per provider route; a route absent here searches with the conversation's current model |
| `delegates` | `{}` | Search provider id per provider route; a delegate naming `model-native` fails at load |

### What a search sends

The request mirrors Claude Code: the system prompt `You are an assistant for performing a web search tool use`, one user message `Perform a web search for the query: <query>`, and the search tool alone. On Anthropic the tool is forced with `max_uses: 8` and thinking disabled; a model that cannot disable thinking keeps it and receives an automatic tool choice. The public Responses API receives `tool_choice: required` and asks for `web_search_call.action.sources`; the ChatGPT Codex backend receives an automatic choice. The route's credential, OAuth sign-in, endpoint, and headers apply unchanged, and every request refuses HTTP redirects.

### What a search returns

The provider's commentary and per-search errors (`Web search error: <code>`) become `content` in response order; result links and URL citations become deduplicated `sources` with titles when present. Before dispatch the provider appends a log-only `web/model-search-request` event holding the route, model, protocol, and request body to the initiating Session.

### Failures

| Code | Cause |
|---|---|
| `WEB_MODEL_ROUTE_UNKNOWN` | No initiating Session, or the Session has made no model request yet |
| `WEB_PROVIDER_UNSUPPORTED` | The route's adapter or protocol has no native search and no delegate is configured |
| `WEB_ABORTED` | The caller cancelled the search |
| `WEB_PROVIDER_ERROR` | Any other adapter, credential, HTTP, or provider failure |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider reads the route and model from the initiating Session's latest `request/context` event and calls `ctx.llm.webSearch()`, which dispatches to `LlmAdapter.webSearch()` of the adapter owning the route. The base adapter rejects with `UNSUPPORTED_WEB_SEARCH`. `dsh-llm-pi-ai` overrides it: it streams the auxiliary request through the route's pi-ai collection, attaches the search tool in `onPayload`, and reads server-tool events from a copy of the response stream taken by a `fetch` wrapper, because pi-ai's assistant events omit server-tool blocks.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, self-delegation check, provider registration |
| [`src/provider.ts`](src/provider.ts) | `ModelNativeSearchProvider`, result mapping, error mapping, event declaration |
| — | No runtime invariant companion is published; the provider holds no state beyond its configuration. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool.
- [dsh-web-search-deepseek](../web-search-deepseek/README.md) — the DeepSeek native search the DeepSeek routes delegate to.
- [dsh-llm-pi-ai](../../llm/llm-pi-ai/README.md) — the adapter that implements native search for pi-ai routes.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which renders this provider's commentary as the answer text and its links as sources, or its failure messages under the tool's error wrapper. The auxiliary search request is a separate model request; it does not enter the conversation's request history.

#### KV Cache effect

None for the conversation; the auxiliary request runs without prompt caching of the conversation prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Google, Bedrock, and OpenAI-compatible Chat Completions routes are unsupported** — pi-ai's Google adapter rejects a custom `fetch`, and the other protocols carry no standard server-side search tool.
- **Domain filters are not exposed** — the `web_search` tool has no `allowed_domains`/`blocked_domains` arguments.
- **A gateway route searches only if the gateway forwards the server-side search tool.**

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

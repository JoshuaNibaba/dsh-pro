/**
 * The `model-native` search provider: each search runs on the provider route
 * that serves the initiating Session, through that route's server-side search
 * tool, as Claude Code's WebSearch tool does with its own model.
 * @module @deepseek-ai/dsh-web-search-model/provider
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { LlmError, WEB_SEARCH_UNSUPPORTED_CODE } from '@deepseek-ai/dsh-llm'
import type { LlmWebSearchRequestRecord, LlmWebSearchResult, LlmWebSearchSegment } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Search provider id registered in `ctx.web`. */
export const MODEL_NATIVE_PROVIDER_ID = 'model-native'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary native-search model request recorded before dispatch. */
    'web/model-search-request': LlmWebSearchRequestRecord
  }
}

/** Route-keyed choices that change how one route searches. */
export interface ModelSearchRouting {
  /** Search model id per provider route; an absent route searches with the conversation's model. */
  readonly models: Readonly<Record<string, string>>
  /** Search provider id per provider route, for routes whose native search another provider serves. */
  readonly delegates: Readonly<Record<string, string>>
}

/**
 * Render a native search outcome as one seam result: commentary and
 * per-search errors become `content` in response order, and result links
 * become deduplicated `sources`.
 * @param result - the adapter's ordered segments.
 * @returns the seam result; the seam applies `maxResults`.
 */
export function toWebSearchResult(result: LlmWebSearchResult): WebSearchResult {
  const content: string[] = []
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  const add = (segment: LlmWebSearchSegment): void => {
    switch (segment.type) {
      case 'text':
        content.push(segment.text)
        return
      case 'error':
        content.push(`Web search error: ${segment.code}`)
        return
      case 'links':
        for (const link of segment.links) {
          if (seen.has(link.url)) continue
          seen.add(link.url)
          sources.push(link.title === undefined ? { url: link.url } : { url: link.url, title: link.title })
        }
    }
  }
  result.segments.forEach(add)
  return {
    ...content.length > 0 ? { content: content.join('\n\n') } : {},
    sources,
    truncated: false,
  }
}

/** Translate an adapter failure into the seam's error vocabulary. */
function webError(error: unknown, provider: string, signal: AbortSignal | undefined): WebError {
  if (signal?.aborted === true || (error instanceof LlmError && error.code === 'ABORTED')) {
    return new WebError('model-native web search aborted', 'WEB_ABORTED', { cause: error })
  }
  if (error instanceof LlmError && error.code === WEB_SEARCH_UNSUPPORTED_CODE) {
    return new WebError(
      `${error.message}. Switch to a model whose provider offers native web search, or route provider "${provider}" `
      + 'to another search provider through web-search-model.delegates.',
      'WEB_PROVIDER_UNSUPPORTED',
      { cause: error },
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  return new WebError(`model-native web search on provider "${provider}" failed: ${message}`, 'WEB_PROVIDER_ERROR', { cause: error })
}

/**
 * Search provider that dispatches through the initiating Session's model
 * route. A search without an initiating Session, or before the Session's first
 * model request, has no route and fails with `WEB_MODEL_ROUTE_UNKNOWN`.
 */
export class ModelNativeSearchProvider implements WebSearchProvider {
  readonly id = MODEL_NATIVE_PROVIDER_ID

  /**
   * @param ctx - plugin context supplying `llm`, `agents`, and `web`.
   * @param routing - returns the current route-keyed choices for each search.
   */
  constructor(private readonly ctx: Context, private readonly routing: () => ModelSearchRouting) {}

  available(): boolean {
    return this.ctx.get('llm') !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const session = this.ctx.get('agents')?.currentInitiator()?.session
    const route = session?.requestContext()
    if (session === undefined || route === undefined) {
      throw new WebError(
        'model-native web search needs the model route of the conversation that called it, and none is recorded yet',
        'WEB_MODEL_ROUTE_UNKNOWN',
      )
    }
    const routing = this.routing()
    const delegate = routing.delegates[route.provider]
    if (delegate !== undefined) return this.ctx.web.search(request, signal, delegate)
    const llm = this.ctx.get('llm')
    if (llm === undefined) throw new WebError('model-native web search requires the llm service', 'WEB_PROVIDER_UNAVAILABLE')
    try {
      return toWebSearchResult(await llm.webSearch({
        provider: route.provider,
        model: routing.models[route.provider] ?? route.model,
        query: request.query,
        ...signal === undefined ? {} : { signal },
        onRequest: (record) => {
          session.append('web/model-search-request', record)
        },
      }))
    } catch (error: unknown) {
      throw webError(error, route.provider, signal)
    }
  }
}

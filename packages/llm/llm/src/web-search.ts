/**
 * Route-native web search vocabulary for {@link LlmAdapter.webSearch}. One
 * search is an auxiliary model request on the same provider route as the
 * conversation, carrying that provider's server-side search tool; the adapter
 * returns the provider's commentary and citeable links.
 * @module @deepseek-ai/dsh-llm/web-search
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Machine code for a route whose adapter or protocol has no native web search. */
export const WEB_SEARCH_UNSUPPORTED_CODE = 'UNSUPPORTED_WEB_SEARCH'

/** One native search issued through the route that serves a conversation. */
export interface LlmWebSearchRequest {
  /** Registered provider route that dispatches the search. */
  readonly provider: string
  /** Exact model id sent on that route. */
  readonly model: string
  /** Search query text. */
  readonly query: string
  /** Cancellation for the whole search request. */
  readonly signal?: AbortSignal
  /**
   * Receives the final provider request body once, before dispatch, so the
   * caller can log the auxiliary model request.
   */
  readonly onRequest?: (record: LlmWebSearchRequestRecord) => void
}

/** The wire request one native search sends. */
export interface LlmWebSearchRequestRecord {
  /** Provider route that dispatched the request. */
  provider: string
  /** Model id sent on that route. */
  model: string
  /** Wire protocol id of the route, such as `anthropic-messages`. */
  api: string
  /** Provider request body after the native search tool was attached. */
  body: JsonValue
}

/** One citeable link returned by the provider's search tool. */
export interface LlmWebSearchLink {
  /** Absolute result URL. */
  readonly url: string
  /** Result title, when the provider returned one. */
  readonly title?: string
}

/** One ordered piece of a native search response. */
export type LlmWebSearchSegment =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'links'; readonly links: readonly LlmWebSearchLink[] }
  | { readonly type: 'error'; readonly code: string }

/** Native search outcome in provider response order. */
export interface LlmWebSearchResult {
  /** Commentary, result-link groups, and per-search errors in response order. */
  readonly segments: readonly LlmWebSearchSegment[]
  /** Number of server-side searches the provider reported. */
  readonly searchCount: number
}

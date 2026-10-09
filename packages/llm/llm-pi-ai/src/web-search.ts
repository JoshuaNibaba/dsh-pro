/**
 * Route-native web search over pi-ai, following Claude Code's WebSearch tool:
 * one auxiliary request on the conversation's own route whose only tool is the
 * provider's server-side search tool. pi-ai owns authentication, endpoint, and
 * protocol framing; `onPayload` attaches the search tool and a `fetch` wrapper
 * reads the provider's server-tool events from a copy of the response stream,
 * because pi-ai's assistant events omit server-tool blocks.
 * @module dsh-llm-pi-ai/web-search
 */

import { EMPTY_RESPONSE_CODE, LlmError, WEB_SEARCH_UNSUPPORTED_CODE } from '@deepseek-ai/dsh-llm'
import type {
  FinishReason, LlmWebSearchLink, LlmWebSearchRequest, LlmWebSearchRequestRecord, LlmWebSearchResult, LlmWebSearchSegment,
} from '@deepseek-ai/dsh-llm'
import type { Api, Context, FetchFunction, Model, Models, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { toStreamChunks } from './stream.ts'

/** System prompt of Claude Code's auxiliary web-search request. */
export const WEB_SEARCH_SYSTEM_PROMPT = 'You are an assistant for performing a web search tool use'

/** Prefix of Claude Code's auxiliary web-search user message; the query follows it. */
export const WEB_SEARCH_USER_PREFIX = 'Perform a web search for the query: '

/** Claude Code's `max_uses` for Anthropic's server-side web search tool. */
export const ANTHROPIC_WEB_SEARCH_MAX_USES = 8

/** Protocol family whose server-side search tool this module can attach and read. */
export type WebSearchFamily = 'anthropic' | 'openai-responses'

const FAMILIES: Readonly<Record<string, WebSearchFamily>> = {
  'anthropic-messages': 'anthropic',
  'openai-responses': 'openai-responses',
  'azure-openai-responses': 'openai-responses',
  'openai-codex-responses': 'openai-responses',
}

/**
 * Select the native search family for one model's wire protocol.
 * @param model - resolved pi-ai model descriptor.
 * @returns the supported family; throws `LlmError` with
 *   {@link WEB_SEARCH_UNSUPPORTED_CODE} for every other protocol.
 */
export function webSearchFamily(model: Model<Api>): WebSearchFamily {
  const family = FAMILIES[model.api]
  if (family === undefined) {
    throw new LlmError(
      `provider "${model.provider}" uses the "${model.api}" protocol, which has no native web search`,
      WEB_SEARCH_UNSUPPORTED_CODE,
    )
  }
  return family
}

type Payload = Record<string, unknown>

function isRecord(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Attach the family's server-side search tool to one provider payload.
 * Anthropic mirrors Claude Code: the search tool is forced and thinking is
 * disabled, except for a model that cannot disable thinking, where a forced
 * tool choice would be rejected and the choice stays automatic.
 * @param family - native search family of the route.
 * @param model - resolved pi-ai model descriptor.
 * @param payload - the body pi-ai built for the request.
 * @returns a new body carrying only the search tool.
 */
export function withSearchTool(family: WebSearchFamily, model: Model<Api>, payload: Payload): Payload {
  switch (family) {
    case 'anthropic': {
      const canDisableThinking = model.thinkingLevelMap?.off !== null
      const { thinking: _thinking, output_config: _outputConfig, ...rest } = payload
      return {
        ...canDisableThinking ? rest : payload,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: ANTHROPIC_WEB_SEARCH_MAX_USES }],
        tool_choice: canDisableThinking ? { type: 'tool', name: 'web_search' } : { type: 'auto' },
        ...canDisableThinking && model.reasoning ? { thinking: { type: 'disabled' } } : {},
      }
    }
    case 'openai-responses': {
      // The ChatGPT Codex backend accepts only automatic tool choice and no
      // `include` expansion; the public Responses API accepts both.
      const codex = model.api === 'openai-codex-responses'
      return {
        ...payload,
        tools: [{ type: 'web_search' }],
        tool_choice: codex ? 'auto' : 'required',
        ...codex ? {} : { include: ['web_search_call.action.sources'] },
      }
    }
  }
}

/** Collects one response's search segments from decoded server-sent events. */
class SegmentCollector {
  readonly segments: LlmWebSearchSegment[] = []
  private text = ''
  private searchCalls = 0
  private searchResults = 0
  private readonly textBlocks = new Set<number>()

  constructor(private readonly family: WebSearchFamily) {}

  get searchCount(): number {
    return Math.max(this.searchCalls, this.searchResults)
  }

  /** Consume one SSE `data` payload. */
  accept(event: unknown): void {
    if (!isRecord(event)) return
    if (this.family === 'anthropic') this.acceptAnthropic(event)
    else this.acceptResponses(event)
  }

  /** Flush trailing commentary; call once after the stream ends. */
  finish(): void {
    this.flushText()
  }

  private flushText(): void {
    const text = this.text.trim()
    if (text.length > 0) this.segments.push({ type: 'text', text })
    this.text = ''
  }

  private pushLinks(links: LlmWebSearchLink[]): void {
    if (links.length > 0) this.segments.push({ type: 'links', links })
  }

  private acceptAnthropic(event: Payload): void {
    if (event['type'] === 'content_block_start' && isRecord(event['content_block'])) {
      const block = event['content_block']
      switch (block['type']) {
        case 'server_tool_use':
          this.searchCalls++
          this.flushText()
          return
        case 'web_search_tool_result': {
          this.searchResults++
          const content = block['content']
          if (Array.isArray(content)) {
            this.pushLinks(content.filter(isRecord).flatMap(link))
          } else {
            const code = isRecord(content) && typeof content['error_code'] === 'string' ? content['error_code'] : 'unknown'
            this.segments.push({ type: 'error', code })
          }
          return
        }
        case 'text':
          if (typeof event['index'] === 'number') this.textBlocks.add(event['index'])
          if (typeof block['text'] === 'string') this.text += block['text']
          return
        default:
          return
      }
    }
    if (event['type'] === 'content_block_delta' && isRecord(event['delta'])
      && typeof event['index'] === 'number' && this.textBlocks.has(event['index'])) {
      const delta = event['delta']
      if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') this.text += delta['text']
    }
  }

  private acceptResponses(event: Payload): void {
    if (event['type'] !== 'response.output_item.done' || !isRecord(event['item'])) return
    const item = event['item']
    if (item['type'] === 'web_search_call') {
      this.searchCalls++
      this.searchResults++
      const sources = isRecord(item['action']) ? item['action']['sources'] : undefined
      if (Array.isArray(sources)) this.pushLinks(sources.filter(isRecord).flatMap(link))
      return
    }
    if (item['type'] !== 'message' || !Array.isArray(item['content'])) return
    for (const part of item['content']) {
      if (!isRecord(part) || part['type'] !== 'output_text' || typeof part['text'] !== 'string') continue
      this.text += part['text']
      this.flushText()
      const annotations = Array.isArray(part['annotations']) ? part['annotations'] : []
      this.pushLinks(annotations.filter(annotation => isRecord(annotation) && annotation['type'] === 'url_citation')
        .filter(isRecord).flatMap(link))
    }
  }
}

/** Read `{ url, title }` from one provider result or citation record. */
function link(record: Payload): LlmWebSearchLink[] {
  const url = record['url']
  if (typeof url !== 'string' || url.length === 0) return []
  const title = record['title']
  return [typeof title === 'string' && title.length > 0 ? { url, title } : { url }]
}

/**
 * Decode one server-sent event stream and hand each JSON `data` payload to
 * `accept`. Comment lines, `event:` names, and non-JSON data are ignored.
 * @param body - the response body copy.
 * @param accept - receives each parsed payload in stream order.
 */
export async function readServerSentEvents(body: ReadableStream<Uint8Array>, accept: (event: unknown) => void): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  const dispatch = (raw: string): void => {
    const data = raw.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (data.length === 0 || data === '[DONE]') return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch (_notJson) {
      // A non-JSON data line carries no search block.
      return
    }
    accept(parsed)
  }
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    let boundary = buffer.search(/\r?\n\r?\n/)
    while (boundary !== -1) {
      dispatch(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '')
      boundary = buffer.search(/\r?\n\r?\n/)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim().length > 0) dispatch(buffer)
}

/**
 * Wrap `fetch` so every request refuses redirects and each event-stream
 * response is read a second time by `observe`.
 * @param base - the underlying fetch implementation.
 * @param observe - receives a copy of every `text/event-stream` body; the
 *   returned promise settles when that copy is fully read.
 * @returns the wrapper and the pending observation promises.
 */
export function observingFetch(
  base: FetchFunction,
  observe: (body: ReadableStream<Uint8Array>) => Promise<void>,
): { fetch: FetchFunction; observed: Promise<void>[] } {
  const observed: Promise<void>[] = []
  const wrapped: FetchFunction = async (input, init) => {
    const response = await base(input, { ...init, redirect: 'error' })
    const contentType = response.headers.get('content-type') ?? ''
    if (response.body === null || !contentType.includes('text/event-stream')) return response
    const [forward, copy] = response.body.tee()
    observed.push(observe(copy))
    return new Response(forward, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  return { fetch: wrapped, observed }
}

/** Inputs {@link runWebSearch} needs from the owning adapter. */
export interface WebSearchDispatch {
  /** The collection that serves the route. */
  models: Models
  /** Resolved descriptor of the search model. */
  model: Model<Api>
  /** Route options: credential, transport knobs, and headers. */
  options: SimpleStreamOptions
  /** Fetch implementation the wrapper delegates to; defaults to `globalThis.fetch`. */
  fetch?: FetchFunction
  /** Final request-body rewrite after the search tool is attached, such as client emulation. */
  transformPayload?: (payload: Record<string, unknown>) => Record<string, unknown> | undefined
}

/**
 * Run one Claude Code-style native web search on a pi-ai route.
 * @param dispatch - collection, model, and route options from the adapter.
 * @param request - query, cancellation, and request observer.
 * @returns the provider's commentary, links, and per-search errors in order.
 */
export async function runWebSearch(dispatch: WebSearchDispatch, request: LlmWebSearchRequest): Promise<LlmWebSearchResult> {
  const { model } = dispatch
  const family = webSearchFamily(model)
  const collector = new SegmentCollector(family)
  const { fetch, observed } = observingFetch(dispatch.fetch ?? globalThis.fetch, async (body) => {
    await readServerSentEvents(body, (event) => { collector.accept(event) })
  })
  const context: Context = {
    systemPrompt: WEB_SEARCH_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `${WEB_SEARCH_USER_PREFIX}${request.query}`, timestamp: Date.now() }],
  }
  const events = dispatch.models.streamSimple(model, context, {
    ...dispatch.options,
    // A one-shot search has nothing worth caching, and a relay that prepends
    // its own default-ttl (5m) system blocks would reject the route's 1h
    // markers behind them: "a ttl='1h' cache_control block must not come
    // after a ttl='5m' cache_control block".
    cacheRetention: 'none',
    ...request.signal === undefined ? {} : { signal: request.signal },
    // The response copy is read from the HTTP body; a WebSocket would bypass it.
    ...model.api === 'openai-codex-responses' ? { transport: 'sse' as const } : {},
    fetch,
    onPayload: (payload) => {
      if (!isRecord(payload)) return undefined
      const searchBody = withSearchTool(family, model, payload)
      const body = dispatch.transformPayload?.(searchBody) ?? searchBody
      request.onRequest?.({
        provider: request.provider,
        model: request.model,
        api: model.api,
        body: JSON.parse(JSON.stringify(body)) as LlmWebSearchRequestRecord['body'],
      })
      return body
    },
  })
  let finish: FinishReason | undefined
  for await (const chunk of toStreamChunks(events, model.contextWindow, request.signal, model.id)) {
    if (chunk.type === 'finish') finish = chunk.reason
  }
  // An aborted or failed request also fails its body copy; the finish reason
  // reports that outcome, so only a copy failure under a clean finish is raised.
  const observations = await Promise.allSettled(observed)
  collector.finish()
  if (finish?.kind === 'aborted') throw new LlmError(finish.failure.message, 'ABORTED')
  const unread = observations.find(outcome => outcome.status === 'rejected')
  if (finish?.kind !== 'error' && unread !== undefined) {
    throw new LlmError('pi-ai web search response could not be read', 'PI_AI_ERROR', { cause: unread.reason })
  }
  // A response holding only server-tool blocks has no pi-ai content to report.
  const emptyButSearched = finish?.kind === 'error' && finish.failure.code === EMPTY_RESPONSE_CODE
    && collector.segments.length > 0
  if (finish?.kind === 'error' && !emptyButSearched) {
    throw new LlmError(finish.failure.message, finish.failure.code)
  }
  return { segments: collector.segments, searchCount: collector.searchCount }
}

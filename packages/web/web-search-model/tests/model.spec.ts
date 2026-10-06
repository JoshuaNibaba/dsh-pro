import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmWebSearchRequest, LlmWebSearchResult, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import WebRuntime, { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import * as modelPlugin from '@deepseek-ai/dsh-web-search-model'
import { MODEL_NATIVE_PROVIDER_ID, toWebSearchResult } from '../src/provider.ts'

/** Adapter double whose native search returns a scripted outcome and records each request. */
class SearchAdapter extends LlmAdapter {
  readonly requests: LlmWebSearchRequest[] = []

  constructor(private readonly outcome: (request: LlmWebSearchRequest) => Promise<LlmWebSearchResult>) {
    super()
  }

  override webSearch(request: LlmWebSearchRequest): Promise<LlmWebSearchResult> {
    this.requests.push(request)
    return this.outcome(request)
  }

  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not used')
  }
}

/** Adapter double that keeps the base class's unsupported default. */
class PlainAdapter extends LlmAdapter {
  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not used')
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const scripted: LlmWebSearchResult = {
  segments: [
    { type: 'text', text: 'Looking.' },
    { type: 'links', links: [{ url: 'https://a.test/', title: 'A' }, { url: 'https://b.test/' }] },
    { type: 'error', code: 'too_many_requests' },
    { type: 'links', links: [{ url: 'https://a.test/', title: 'A again' }] },
    { type: 'text', text: 'Done.' },
  ],
  searchCount: 2,
}

function configOf(config: Partial<modelPlugin.Config>): modelPlugin.Config {
  return { models: {}, delegates: {}, ...config }
}

interface Harness {
  ctx: Context
  session: Session
  search: (signal?: AbortSignal) => Promise<WebSearchResult>
}

async function harness(
  config: Partial<modelPlugin.Config>,
  adapters: Record<string, LlmAdapter>,
  route = { provider: 'anthropic', model: 'claude-opus-5-5' },
): Promise<Harness> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(WebRuntime, { searchProvider: MODEL_NATIVE_PROVIDER_ID })
  for (const [provider, adapter] of Object.entries(adapters)) ctx.llm.registerAdapter([provider], adapter)
  await ctx.plugin(modelPlugin, configOf(config))
  const session = ctx.sessions.create(SessionId(`web-search-model-${contexts.length}`))
  session.append('turn/start', { turn: 1 })
  session.append('request/context', route)
  const agent = { session } as Agent
  return {
    ctx,
    session,
    search: signal => ctx.agents.withInitiator(agent, () => ctx.web.search({ query: 'dsh', maxResults: 8 }, signal)),
  }
}

describe('model-native search provider', () => {
  it('searches on the initiating route and model and logs the auxiliary request', async () => {
    const adapter = new SearchAdapter(async (request) => {
      request.onRequest?.({ provider: request.provider, model: request.model, api: 'anthropic-messages', body: { tools: [] } })
      return scripted
    })
    const { search, session } = await harness({}, { anthropic: adapter })
    await expect(search()).resolves.toEqual({
      content: 'Looking.\n\nWeb search error: too_many_requests\n\nDone.',
      sources: [{ url: 'https://a.test/', title: 'A' }, { url: 'https://b.test/' }],
      truncated: false,
    })
    expect(adapter.requests.map(({ provider, model, query }) => ({ provider, model, query })))
      .toEqual([{ provider: 'anthropic', model: 'claude-opus-5-5', query: 'dsh' }])
    expect(session.ownEvents().filter(event => event.type === 'web/model-search-request').map(event => event.data))
      .toEqual([{ provider: 'anthropic', model: 'claude-opus-5-5', api: 'anthropic-messages', body: { tools: [] } }])
  })

  it('uses the configured search model for a route', async () => {
    const adapter = new SearchAdapter(async () => ({ segments: [], searchCount: 0 }))
    const { search } = await harness({ models: { anthropic: 'claude-haiku-4-5' } }, { anthropic: adapter })
    await expect(search()).resolves.toEqual({ sources: [], truncated: false })
    expect(adapter.requests[0]?.model).toBe('claude-haiku-4-5')
  })

  it('delegates a configured route to another registered search provider', async () => {
    const adapter = new SearchAdapter(async () => scripted)
    const { ctx, search } = await harness({ delegates: { 'deepseek-official': 'stub' } }, { 'deepseek-official': adapter }, {
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })
    const queries: string[] = []
    ctx.web.registerSearchProvider({
      id: 'stub',
      available: () => true,
      search: (request) => {
        queries.push(request.query)
        return Promise.resolve({ sources: [{ url: 'https://d.test/' }], truncated: false })
      },
    })
    await expect(search()).resolves.toEqual({ sources: [{ url: 'https://d.test/' }], truncated: false })
    expect(queries).toEqual(['dsh'])
    expect(adapter.requests).toEqual([])
  })

  it('fails a route without native search with WEB_PROVIDER_UNSUPPORTED', async () => {
    const { search } = await harness({}, { anthropic: new PlainAdapter() })
    await expect(search()).rejects.toMatchObject({ name: 'WebError', code: 'WEB_PROVIDER_UNSUPPORTED' })
  })

  it('fails an unregistered route with WEB_PROVIDER_ERROR', async () => {
    const { search } = await harness({}, {})
    const error: unknown = await search().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WebError)
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR', cause: { code: 'NO_ADAPTER' } })
  })

  it('reports cancellation as WEB_ABORTED', async () => {
    const controller = new AbortController()
    const adapter = new SearchAdapter(async () => {
      controller.abort()
      throw new LlmError('aborted', 'ABORTED')
    })
    const { search } = await harness({}, { anthropic: adapter })
    await expect(search(controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('fails without an initiating Session route', async () => {
    const { ctx } = await harness({}, { anthropic: new SearchAdapter(async () => scripted) })
    await expect(ctx.web.search({ query: 'dsh' })).rejects.toMatchObject({ code: 'WEB_MODEL_ROUTE_UNKNOWN' })
  })

  it('refuses a delegate that names this provider at load', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebRuntime, {})
    await expect(ctx.plugin(modelPlugin, configOf({ delegates: { anthropic: MODEL_NATIVE_PROVIDER_ID } })))
      .rejects.toThrow('cannot name "model-native" itself')
  })

  it('removes its registration when the plugin is disposed', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(WebRuntime, { searchProvider: MODEL_NATIVE_PROVIDER_ID })
    const fiber = await ctx.plugin(modelPlugin, configOf({}))
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'dsh' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })
})

describe('toWebSearchResult', () => {
  it('omits content when the provider returned only links', () => {
    expect(toWebSearchResult({ segments: [{ type: 'links', links: [{ url: 'https://a.test/' }] }], searchCount: 1 }))
      .toEqual({ sources: [{ url: 'https://a.test/' }], truncated: false })
  })
})

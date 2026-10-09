import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { LlmError, WEB_SEARCH_UNSUPPORTED_CODE } from '@deepseek-ai/dsh-llm'
import type { LlmWebSearchRequestRecord } from '@deepseek-ai/dsh-llm'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import type { Api, Model } from '@earendil-works/pi-ai'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import type { PiAiProviderProfile } from '../src/config.ts'
import {
  ANTHROPIC_WEB_SEARCH_MAX_USES, observingFetch, readServerSentEvents, WEB_SEARCH_SYSTEM_PROMPT,
  WEB_SEARCH_USER_PREFIX, webSearchFamily, withSearchTool,
} from '../src/web-search.ts'
import { ClientEmulationConfigSchema, resolveClientEmulation } from '../src/client-emulation.ts'
import type { ClientEmulationConfig } from '../src/client-emulation.ts'
import { memoryAuth } from './auth-double.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

interface Recorded {
  url: string
  body: Record<string, unknown>
}

/** Serve one scripted event stream; each entry is `[eventName, data]`. */
async function sseServer(events: readonly (readonly [string | undefined, unknown])[]): Promise<{ url: string; requests: Recorded[] }> {
  const requests: Recorded[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push({ url: request.url ?? '', body: JSON.parse(body) as Record<string, unknown> })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const [name, data] of events) {
        response.write(`${name === undefined ? '' : `event: ${name}\n`}data: ${JSON.stringify(data)}\n\n`)
      }
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, requests }
}

function adapterOf(providers: Record<string, PiAiProviderProfile>): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles(providers),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
  })
}

function catalogModel(provider: Parameters<typeof getBuiltinModels>[0], id: string): Model<Api> {
  const model = getBuiltinModels(provider).find(candidate => candidate.id === id)
  if (model === undefined) throw new Error(`catalog lacks ${provider}/${id}`)
  return model
}

const usage = { input_tokens: 10, output_tokens: 5 }

/** Anthropic stream: commentary, one server search, its results, and a summary. */
const anthropicEvents = [
  ['message_start', { type: 'message_start', message: { id: 'msg_1', model: 'claude-haiku-4-5', usage } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Searching now.' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"dsh"}' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 1 }],
  ['content_block_start', {
    type: 'content_block_start',
    index: 2,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: [
        { type: 'web_search_result', url: 'https://a.test/', title: 'A', encrypted_content: 'x' },
        { type: 'web_search_result', url: 'https://b.test/', title: '' },
      ],
    },
  }],
  ['content_block_stop', { type: 'content_block_stop', index: 2 }],
  ['content_block_start', { type: 'content_block_start', index: 3, content_block: { type: 'text', text: 'DSH is ' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'a harness.' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 3 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage }],
  ['message_stop', { type: 'message_stop' }],
] as const

describe('native web search family selection', () => {
  it('accepts Anthropic Messages and the Responses family and refuses other protocols', () => {
    expect(webSearchFamily(catalogModel('anthropic', 'claude-haiku-4-5'))).toBe('anthropic')
    expect(webSearchFamily(catalogModel('openai', 'gpt-4.1'))).toBe('openai-responses')
    expect(webSearchFamily(catalogModel('openai-codex', 'gpt-5.5'))).toBe('openai-responses')
    const completions = { ...catalogModel('openai', 'gpt-4.1'), api: 'openai-completions' } as Model<Api>
    expect(() => webSearchFamily(completions)).toThrow(expect.objectContaining({ code: WEB_SEARCH_UNSUPPORTED_CODE }))
  })
})

describe('search tool payloads', () => {
  it('forces the Anthropic search tool with thinking disabled, like Claude Code', () => {
    const body = withSearchTool('anthropic', catalogModel('anthropic', 'claude-haiku-4-5'), {
      model: 'claude-haiku-4-5', tools: [{ name: 'other' }], thinking: { type: 'enabled' }, output_config: { effort: 'high' },
    })
    expect(body).toEqual({
      model: 'claude-haiku-4-5',
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: ANTHROPIC_WEB_SEARCH_MAX_USES }],
      tool_choice: { type: 'tool', name: 'web_search' },
      thinking: { type: 'disabled' },
    })
  })

  it('keeps thinking and an automatic choice for a model that cannot disable thinking', () => {
    const body = withSearchTool('anthropic', catalogModel('anthropic', 'claude-fable-5'), {
      model: 'claude-fable-5', thinking: { type: 'adaptive' },
    })
    expect(body).toMatchObject({ thinking: { type: 'adaptive' }, tool_choice: { type: 'auto' } })
  })

  it('requires the Responses web_search tool and asks for its sources', () => {
    expect(withSearchTool('openai-responses', catalogModel('openai', 'gpt-4.1'), { model: 'gpt-4.1', tools: [{ type: 'function' }] }))
      .toEqual({ model: 'gpt-4.1', tools: [{ type: 'web_search' }], tool_choice: 'required', include: ['web_search_call.action.sources'] })
  })

  it('keeps the Codex backend on an automatic choice without include expansion', () => {
    expect(withSearchTool('openai-responses', catalogModel('openai-codex', 'gpt-5.5'), { model: 'gpt-5.5' }))
      .toEqual({ model: 'gpt-5.5', tools: [{ type: 'web_search' }], tool_choice: 'auto' })
  })
})

describe('server-sent event decoding', () => {
  it('delivers JSON data payloads across chunk boundaries and skips non-JSON data', async () => {
    const encoder = new TextEncoder()
    const parts = ['event: a\ndata: {"n":', '1}\n\n: comment\n\ndata: not json\n\ndata: [DONE]\n\n', 'data: {"n":2}']
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part))
        controller.close()
      },
    })
    const seen: unknown[] = []
    await readServerSentEvents(body, event => seen.push(event))
    expect(seen).toEqual([{ n: 1 }, { n: 2 }])
  })
})

describe('observing fetch', () => {
  it('refuses redirects on every request and copies only event streams', async () => {
    const inits: (RequestInit | undefined)[] = []
    const copies: string[] = []
    const base: typeof fetch = (_input, init) => {
      inits.push(init)
      const type = inits.length === 1 ? 'text/event-stream' : 'application/json'
      return Promise.resolve(new Response('data: {}\n\n', { headers: { 'content-type': type } }))
    }
    const { fetch: wrapped, observed } = observingFetch(base, async (body) => {
      copies.push(await new Response(body).text())
    })
    const streamed = await wrapped('https://example.test/stream', { method: 'POST' })
    const json = await wrapped('https://example.test/json')
    expect(await streamed.text()).toBe('data: {}\n\n')
    expect(await json.text()).toBe('data: {}\n\n')
    await Promise.all(observed)
    expect(inits.map(init => init?.redirect)).toEqual(['error', 'error'])
    expect(copies).toEqual(['data: {}\n\n'])
  })

  it('does not contact a redirect target', async () => {
    let targetHits = 0
    const target = createServer((_request, response) => {
      targetHits++
      response.end('{}')
    })
    servers.push(target)
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
    const targetAddress = target.address()
    if (targetAddress === null || typeof targetAddress === 'string') throw new Error('no port')
    const origin = createServer((_request, response) => {
      response.writeHead(307, { location: `http://127.0.0.1:${targetAddress.port}/v1/messages` })
      response.end()
    })
    servers.push(origin)
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve))
    const originAddress = origin.address()
    if (originAddress === null || typeof originAddress === 'string') throw new Error('no port')
    const adapter = adapterOf({ anthropic: { baseURL: `http://127.0.0.1:${originAddress.port}` } })
    await expect(adapter.webSearch({ provider: 'anthropic', model: 'claude-haiku-4-5', query: 'q' })).rejects.toBeInstanceOf(LlmError)
    expect(targetHits).toBe(0)
  })
})

describe('PiAiAdapter.webSearch', () => {
  it('sends a Claude Code-style auxiliary request and returns ordered commentary and links', async () => {
    const server = await sseServer(anthropicEvents)
    // Long retention on the route must not reach the search request: a relay
    // that prepends default-ttl system blocks rejects 1h markers behind them.
    const adapter = adapterOf({ anthropic: { baseURL: server.url, cacheRetention: 'long' } })
    const records: LlmWebSearchRequestRecord[] = []
    const result = await adapter.webSearch({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      query: 'dsh harness',
      onRequest: record => records.push(record),
    })
    expect(result).toEqual({
      segments: [
        { type: 'text', text: 'Searching now.' },
        { type: 'links', links: [{ url: 'https://a.test/', title: 'A' }, { url: 'https://b.test/' }] },
        { type: 'text', text: 'DSH is a harness.' },
      ],
      searchCount: 1,
    })
    expect(server.requests).toHaveLength(1)
    const sent = server.requests[0]?.body
    expect(sent).toMatchObject({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: `${WEB_SEARCH_USER_PREFIX}dsh harness` }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: ANTHROPIC_WEB_SEARCH_MAX_USES }],
      tool_choice: { type: 'tool', name: 'web_search' },
    })
    expect(JSON.stringify(sent?.['system'])).toContain(WEB_SEARCH_SYSTEM_PROMPT)
    expect(JSON.stringify(sent)).not.toContain('cache_control')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      provider: 'anthropic', model: 'claude-haiku-4-5', api: 'anthropic-messages',
      body: { tool_choice: { type: 'tool', name: 'web_search' } },
    })
  })

  it('sends the search request as Claude Code when client emulation is enabled', async () => {
    const server = await sseServer(anthropicEvents)
    const clientEmulation = resolveClientEmulation(
      ClientEmulationConfigSchema({ enabled: true } as ClientEmulationConfig),
      { hostname: 'h', osName: 'Linux', osRelease: '6', arch: 'x86_64' },
    )
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ anthropic: { baseURL: server.url } }),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
      ...clientEmulation === undefined ? {} : { clientEmulation },
    })
    await adapter.webSearch({ provider: 'anthropic', model: 'claude-haiku-4-5', query: 'q' })
    const sent = server.requests[0]?.body as { system: { text: string }[]; tools: unknown[]; metadata: { user_id: string } }
    expect(sent.system[0]?.text).toBe('You are Claude Code, Anthropic\'s official CLI for Claude.')
    expect(JSON.stringify(sent.system)).toContain(WEB_SEARCH_SYSTEM_PROMPT)
    expect(sent.tools).toHaveLength(1)
    expect(Object.keys(JSON.parse(sent.metadata.user_id) as Record<string, string>)).toEqual(['device_id', 'account_uuid', 'session_id'])
  })

  it('reports a provider search error as an error segment', async () => {
    const server = await sseServer([
      ['message_start', { type: 'message_start', message: { id: 'msg_2', model: 'claude-haiku-4-5', usage } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's', name: 'web_search', input: {} } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 's', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } } }],
      ['content_block_stop', { type: 'content_block_stop', index: 1 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage }],
      ['message_stop', { type: 'message_stop' }],
    ])
    const adapter = adapterOf({ anthropic: { baseURL: server.url } })
    await expect(adapter.webSearch({ provider: 'anthropic', model: 'claude-haiku-4-5', query: 'q' })).resolves.toEqual({
      segments: [{ type: 'error', code: 'max_uses_exceeded' }],
      searchCount: 1,
    })
  })

  it('reads Responses web_search calls, sources, and cited text', async () => {
    const response = { id: 'resp_1', object: 'response', model: 'gpt-4.1', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
    const message = {
      type: 'message', id: 'msg_1', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Answer.', annotations: [{ type: 'url_citation', url: 'https://c.test/', title: 'C' }] }],
    }
    const server = await sseServer([
      [undefined, { type: 'response.created', response: { ...response, status: 'in_progress' } }],
      [undefined, { type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'q', sources: [{ type: 'url', url: 'https://a.test/' }] } } }],
      [undefined, { type: 'response.output_item.added', output_index: 1, item: { ...message, status: 'in_progress', content: [] } }],
      [undefined, { type: 'response.content_part.added', output_index: 1, content_index: 0, item_id: 'msg_1', part: { type: 'output_text', text: '', annotations: [] } }],
      [undefined, { type: 'response.output_text.delta', output_index: 1, content_index: 0, item_id: 'msg_1', delta: 'Answer.' }],
      [undefined, { type: 'response.output_item.done', output_index: 1, item: message }],
      [undefined, { type: 'response.completed', response: { ...response, output: [message] } }],
    ])
    const adapter = adapterOf({ openai: { baseURL: server.url } })
    const records: LlmWebSearchRequestRecord[] = []
    const result = await adapter.webSearch({ provider: 'openai', model: 'gpt-4.1', query: 'q', onRequest: record => records.push(record) })
    expect(result).toEqual({
      segments: [
        { type: 'links', links: [{ url: 'https://a.test/' }] },
        { type: 'text', text: 'Answer.' },
        { type: 'links', links: [{ url: 'https://c.test/', title: 'C' }] },
      ],
      searchCount: 1,
    })
    expect(server.requests[0]?.body).toMatchObject({ tools: [{ type: 'web_search' }], tool_choice: 'required', include: ['web_search_call.action.sources'] })
    expect(records[0]).toMatchObject({ provider: 'openai', api: 'openai-responses' })
  })

  it('refuses an unsupported protocol before resolving a credential', async () => {
    let resolved = 0
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ acme: { api: 'openai-completions', baseURL: 'http://127.0.0.1:9', models: [{ id: 'm' }] } }),
      resolveApiKey: () => { resolved++; return Promise.resolve('k') },
      auth: memoryAuth(),
    })
    await expect(adapter.webSearch({ provider: 'acme', model: 'm', query: 'q' }))
      .rejects.toMatchObject({ code: WEB_SEARCH_UNSUPPORTED_CODE })
    expect(resolved).toBe(0)
  })
})

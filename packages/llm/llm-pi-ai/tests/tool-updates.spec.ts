import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createDeveloperMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '../src/index.ts'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import type { PiAiProviderProfile } from '../src/config.ts'
import { assemble } from './assemble.ts'
import { memoryAuth } from './auth-double.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

interface Recorded {
  body: Record<string, unknown>
  headers: IncomingHttpHeaders
}

const usage = { input_tokens: 10, output_tokens: 1 }
const textEvents = [
  ['message_start', { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-5-5', usage } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage }],
  ['message_stop', { type: 'message_stop' }],
] as const

/** Anthropic Messages stand-in that records each request and answers with one text block. */
async function messagesServer(): Promise<{ url: string; requests: Recorded[] }> {
  const requests: Recorded[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push({ body: JSON.parse(body) as Record<string, unknown>, headers: request.headers })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const [name, data] of textEvents) response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
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

function tool(name: string): ToolSchema {
  return { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } }
}

describe('pi-ai tool update mode', () => {
  it('declares in-history updates only for models pi-ai sends native tool changes to', async () => {
    const catalog = adapterOf({ anthropic: {}, openai: {} })
    expect((await catalog.resolveModel('anthropic', 'claude-opus-5-5')).toolUpdate).toBe('in-history')
    expect((await catalog.resolveModel('anthropic', 'claude-sonnet-4-6')).toolUpdate).toBeUndefined()
    expect((await catalog.resolveModel('openai', 'gpt-4.1')).toolUpdate).toBeUndefined()
    // A listed model on a catalog route inherits the installed entry's compat for the same id.
    const gateway = adapterOf({
      anthropic: { baseURL: 'https://gateway.test', models: [{ id: 'claude-opus-5-5' }, { id: 'acme-claude' }] },
    })
    expect((await gateway.resolveModel('anthropic', 'claude-opus-5-5')).toolUpdate).toBe('in-history')
    expect((await gateway.resolveModel('anthropic', 'acme-claude')).toolUpdate).toBeUndefined()
    // A gateway that strips the inline-tools beta opts the route out.
    const stripping = adapterOf({ anthropic: { compat: { supportsMidConvoToolChanges: false } } })
    expect((await stripping.resolveModel('anthropic', 'claude-opus-5-5')).toolUpdate).toBeUndefined()
  })

  it('redeclares the current tool list on a route opted out of native tool changes', async () => {
    const server = await messagesServer()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        anthropic: { baseURL: server.url, apiKeyEnv: 'PI_TOOL_UPDATE_KEY', compat: { supportsMidConvoToolChanges: false } },
      },
    })
    process.env['PI_TOOL_UPDATE_KEY'] = 'test-key'
    const update = createDeveloperMessage({ content: [{ type: 'tool-addition', toolName: 'beta' }], source: { kind: 'system-prompt' } })
    const first = createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'system-prompt' } })
    try {
      await assemble(ctx, {
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        system: 'system prompt',
        messages: [first, update],
        tools: [tool('alpha'), tool('beta')],
        toolHistory: { tools: [tool('alpha')], updates: [{ messageId: update.id, additions: [tool('beta')] }] },
      })
    } finally {
      delete process.env['PI_TOOL_UPDATE_KEY']
    }

    const [request] = server.requests
    const body = request?.body as { tools: { name: string }[]; messages: unknown[] }
    expect(body.tools.map(declared => declared.name)).toEqual(['alpha', 'beta'])
    expect(JSON.stringify(body.messages)).not.toContain('tool_addition')
    expect(String(request?.headers['anthropic-beta'])).not.toContain('inline-tools')
  })

  it('sends a recorded tool addition as an inline tool_addition without changing the leading tools', async () => {
    const server = await messagesServer()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { anthropic: { baseURL: server.url, apiKeyEnv: 'PI_TOOL_UPDATE_KEY' } } })
    process.env['PI_TOOL_UPDATE_KEY'] = 'test-key'
    const update = createDeveloperMessage({ content: [{ type: 'tool-addition', toolName: 'beta' }], source: { kind: 'system-prompt' } })
    const first = createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'system-prompt' } })
    const second = createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'system-prompt' } })
    try {
      await assemble(ctx, {
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        system: 'system prompt',
        messages: [first, update, second],
        tools: [tool('alpha'), tool('beta')],
        toolHistory: { tools: [tool('alpha')], updates: [{ messageId: update.id, additions: [tool('beta')] }] },
      })
    } finally {
      delete process.env['PI_TOOL_UPDATE_KEY']
    }

    const [request] = server.requests
    const body = request?.body as { tools: { name: string }[]; messages: { role: string; content: unknown }[] }
    expect(body.tools.map(declared => declared.name)).toEqual(['alpha', '__pi_deferred_placeholder__'])
    const toolChange = body.messages.find(message => message.role === 'system'
      && JSON.stringify(message.content).includes('tool_addition'))
    expect(toolChange?.content).toEqual([expect.objectContaining({
      type: 'tool_addition',
      tool: { type: 'tool_definition', definition: expect.objectContaining({ name: 'beta', description: 'beta tool' }) },
    })])
    expect(String(request?.headers['anthropic-beta'])).toContain('inline-tools-2026-09-15')
  })
})

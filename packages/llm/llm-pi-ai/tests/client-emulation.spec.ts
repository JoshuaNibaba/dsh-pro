import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, userAgent } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '../src/index.ts'
import {
  ClientEmulationConfigSchema,
  emulatedClientFor,
  emulatedSessionId,
  emulationHeaders,
  emulationHostFacts,
  emulationPayload,
  resolveClientEmulation,
} from '../src/client-emulation.ts'
import type { ClientEmulationConfig, ResolvedClientEmulation } from '../src/client-emulation.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const servers: Server[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

const HOST = { hostname: 'build-host', osName: 'Linux', osRelease: '6.8.0', arch: 'x86_64' }
const DEVICE_ID = 'ab'.repeat(32)
const SESSION_UUID = 'd4836600-a5eb-4d60-b76e-7bffb24b32a5'
const CLAUDE_CODE_IDENTITY = 'You are Claude Code, Anthropic\'s official CLI for Claude.'
const CODEX_IDENTITY = 'You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user\'s computer.'

function enabled(overrides: Partial<ClientEmulationConfig['claudeCode']> = {}): ClientEmulationConfig {
  const config = ClientEmulationConfigSchema({ enabled: true })
  return { ...config, claudeCode: { ...config.claudeCode, ...overrides } }
}

function resolved(config: ClientEmulationConfig): ResolvedClientEmulation {
  const emulation = resolveClientEmulation(config, HOST)
  if (emulation === undefined) throw new Error('emulation is disabled')
  return emulation
}

interface Recorded {
  body: Record<string, unknown>
  headers: IncomingHttpHeaders
}

const usage = { input_tokens: 10, output_tokens: 1 }
const anthropicEvents = [
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
      for (const [name, data] of anthropicEvents) response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, requests }
}

async function mount(providers: Record<string, unknown>, clientEmulation: ClientEmulationConfig): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers, clientEmulation })
  return ctx
}

async function drain(ctx: Context, provider: string, model: string): Promise<void> {
  for await (const _chunk of ctx.llm.stream({
    provider,
    model,
    system: 'you are a harness',
    sessionId: `session-${SESSION_UUID}` as never,
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }] })],
  })) {
    // The recorded request is the assertion.
  }
}

describe('client emulation resolution', () => {
  it('stays off by default', () => {
    expect(resolveClientEmulation(ClientEmulationConfigSchema({}), HOST)).toBeUndefined()
  })

  it('selects the emulated client from the route protocol', () => {
    expect(emulatedClientFor('anthropic-messages')).toBe('claude-code')
    expect(emulatedClientFor('openai-completions')).toBe('codex')
    expect(emulatedClientFor('openai-responses')).toBe('codex')
    expect(emulatedClientFor('openai-codex-responses')).toBe('codex')
    expect(emulatedClientFor('google-generative-ai')).toBeUndefined()
  })

  it('derives a stable device id and renders the Codex user agent', () => {
    const first = resolved(enabled())
    const second = resolved(enabled())
    expect(first.claudeCode.deviceId).toMatch(/^[0-9a-f]{64}$/)
    expect(first.claudeCode.deviceId).toBe(second.claudeCode.deviceId)
    expect(resolved(enabled({ deviceId: DEVICE_ID })).claudeCode.deviceId).toBe(DEVICE_ID)
    expect(first.codex.userAgent).toBe('codex_cli_rs/0.153.4 (Linux 6.8.0; x86_64) xterm-256color')
  })

  it('renders host facts in Codex spelling', () => {
    expect(emulationHostFacts({ hostname: 'h', platform: 'darwin', release: '25.0.0', arch: 'arm64' }))
      .toEqual({ hostname: 'h', osName: 'Mac OS', osRelease: '25.0.0', arch: 'arm64' })
    expect(emulationHostFacts({ hostname: 'h', platform: 'linux', release: '6.8', arch: 'x64' }))
      .toEqual({ hostname: 'h', osName: 'Linux', osRelease: '6.8', arch: 'x86_64' })
    expect(emulationHostFacts({ hostname: 'h', platform: 'freebsd', release: '14', arch: 'riscv64' }))
      .toEqual({ hostname: 'h', osName: 'freebsd', osRelease: '14', arch: 'riscv64' })
  })

  it('maps Harness session ids to UUIDs', () => {
    const emulation = resolved(enabled())
    expect(emulatedSessionId(emulation, `session-${SESSION_UUID.toUpperCase()}`)).toBe(SESSION_UUID)
    const hashed = emulatedSessionId(emulation, 'plain-session')
    expect(hashed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(emulatedSessionId(emulation, 'plain-session')).toBe(hashed)
    expect(emulatedSessionId(emulation, undefined)).toBe(emulation.processSessionId)
  })
})

describe('client emulation request bodies', () => {
  const emulation = resolved(enabled({ deviceId: DEVICE_ID }))

  it('leaves non-object bodies alone', () => {
    expect(emulationPayload(emulation, 'claude-code', 'raw', SESSION_UUID)).toBeUndefined()
    expect(emulationPayload(emulation, 'codex', null, SESSION_UUID)).toBeUndefined()
  })

  it('normalizes Claude Code system and beta fields without duplicating them', () => {
    const fromString = emulationPayload(emulation, 'claude-code', { system: 'harness', metadata: { other: 1 } }, SESSION_UUID)
    expect(fromString?.system).toEqual([{ type: 'text', text: CLAUDE_CODE_IDENTITY }, { type: 'text', text: 'harness' }])
    expect(fromString?.betas).toEqual(['claude-code-20250219'])
    expect(fromString?.metadata).toMatchObject({ other: 1 })
    const again = emulationPayload(emulation, 'claude-code', fromString, SESSION_UUID)
    expect(again?.system).toEqual(fromString?.system)
    expect(again?.betas).toEqual(['claude-code-20250219'])
    expect(emulationPayload(emulation, 'claude-code', {}, SESSION_UUID)?.system).toEqual([{ type: 'text', text: CLAUDE_CODE_IDENTITY }])
  })

  it('places the Codex identity in instructions or the leading instruction message', () => {
    expect(emulationPayload(emulation, 'codex', { instructions: 'harness' }, SESSION_UUID))
      .toEqual({ instructions: `${CODEX_IDENTITY}\n\nharness` })
    const prefixed = { instructions: `${CODEX_IDENTITY}\n\nharness` }
    expect(emulationPayload(emulation, 'codex', prefixed, SESSION_UUID)).toBe(prefixed)
    const developer = { role: 'developer', content: 'harness' }
    expect(emulationPayload(emulation, 'codex', { input: [developer, { role: 'user' }] }, SESSION_UUID))
      .toEqual({ input: [{ role: 'developer', content: `${CODEX_IDENTITY}\n\nharness` }, { role: 'user' }] })
    const done = { role: 'system', content: `${CODEX_IDENTITY}\n\nharness` }
    expect(emulationPayload(emulation, 'codex', { messages: [done] }, SESSION_UUID)).toEqual({ messages: [done] })
    expect(emulationPayload(emulation, 'codex', { input: [{ role: 'user', content: 'hi' }] }, SESSION_UUID))
      .toEqual({ input: [{ role: 'system', content: CODEX_IDENTITY }, { role: 'user', content: 'hi' }] })
    expect(emulationPayload(emulation, 'codex', { input: [{ role: 'system', content: [] }] }, SESSION_UUID))
      .toEqual({ input: [{ role: 'system', content: CODEX_IDENTITY }, { role: 'system', content: [] }] })
    expect(emulationPayload(emulation, 'codex', { model: 'gpt' }, SESSION_UUID)).toEqual({ model: 'gpt' })
  })

  it('renders a configured Codex user agent verbatim', () => {
    const config = ClientEmulationConfigSchema({ enabled: true, codex: { userAgent: 'codex_cli_rs/1.0.0 (Mac OS 26.5.2; arm64) iTerm.app/3.6.8' } })
    expect(emulationHeaders(resolved(config), 'codex', SESSION_UUID)['user-agent'])
      .toBe('codex_cli_rs/1.0.0 (Mac OS 26.5.2; arm64) iTerm.app/3.6.8')
  })
})

describe('client emulation requests', () => {
  it('sends Anthropic routes as Claude Code', async () => {
    const server = await messagesServer()
    const ctx = await mount({
      anthropic: {
        apiKeyEnv: 'PI_TEST_KEY',
        baseURL: server.url,
        headers: { 'User-Agent': 'deployment', 'x-company': 'private' },
        compat: { supportsMidConvoToolChanges: false },
      },
    }, enabled({ deviceId: DEVICE_ID }))
    await drain(ctx, 'anthropic', 'claude-opus-5-5')

    const [request] = server.requests
    expect(request?.headers['user-agent']).toBe('claude-cli/2.1.280 (external, cli)')
    expect(request?.headers['x-app']).toBe('cli')
    expect(request?.headers['x-company']).toBe('private')
    expect(request?.headers['x-claude-code-session-id']).toBe(SESSION_UUID)
    expect(request?.headers['anthropic-dangerous-direct-browser-access']).toBeUndefined()
    expect(String(request?.headers['anthropic-beta']).split(',')[0]).toBe('claude-code-20250219')
    const system = request?.body.system as { text: string }[]
    expect(system.map(block => block.text)).toEqual([CLAUDE_CODE_IDENTITY, 'you are a harness'])
    expect(JSON.parse((request?.body.metadata as { user_id: string }).user_id)).toEqual({
      device_id: DEVICE_ID,
      account_uuid: '',
      session_id: SESSION_UUID,
    })
  })

  it('sends OpenAI routes as the Codex CLI', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } }, enabled())
    await drain(ctx, 'deepseek', 'deepseek-flash')

    const headers = server.headers[0]
    expect(headers?.['user-agent']).toMatch(/^codex_cli_rs\/0\.153\.4 \(/)
    expect(headers?.originator).toBe('codex_cli_rs')
    expect(headers?.version).toBe('0.153.4')
    expect(headers?.session_id).toBe(SESSION_UUID)
    const body = server.requests[0] as { messages: { role: string; content: string }[] }
    expect(body.messages[0]?.content).toBe(`${CODEX_IDENTITY}\n\nyou are a harness`)
  })

  it('keeps Harness attribution on protocols without an emulated client', async () => {
    const server = await mockServer([{ status: 500 }])
    const ctx = await mount({ google: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } }, enabled())
    await drain(ctx, 'google', 'gemini-2.5-flash').catch(() => undefined)
    expect(server.headers[0]?.['user-agent']).not.toMatch(/^(claude-cli|codex_cli_rs)/)
    expect(server.headers[0]?.originator).toBeUndefined()
  })

  it('keeps Harness attribution when disabled', async () => {
    const server = await messagesServer()
    const ctx = await mount({
      anthropic: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, compat: { supportsMidConvoToolChanges: false } },
    }, ClientEmulationConfigSchema({}))
    await drain(ctx, 'anthropic', 'claude-opus-5-5')

    const [request] = server.requests
    expect(request?.headers['user-agent']).toBe(userAgent())
    expect(request?.headers['x-claude-code-session-id']).toBeUndefined()
    expect((request?.body.system as { text: string }[]).map(block => block.text)).toEqual(['you are a harness'])
    expect(request?.body.metadata).toBeUndefined()
  })
})

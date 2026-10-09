/**
 * Client emulation for subscription relays such as sub2api: requests on an
 * Anthropic Messages route present themselves as Claude Code, and requests on
 * an OpenAI route present themselves as the Codex CLI. The route protocol
 * selects the emulated client; the deployment turns the whole feature on in
 * the plugin Config.
 *
 * Emulation replaces the Harness attribution `User-Agent`, adds the emulated
 * client's identity headers, prepends its identity sentence to the system
 * prompt, and on Claude Code routes sends Claude Code's `metadata.user_id`.
 * The identity sentence is derived from Config, so a request stays
 * reconstructable from the session log and the deployment configuration.
 *
 * @module dsh-llm-pi-ai/client-emulation
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Api } from '@earendil-works/pi-ai'
import z from '@deepseek-ai/schemastery'

/** Claude Code emulation settings. */
export interface ClaudeCodeEmulationConfig {
  /** Claude Code version rendered into `User-Agent: claude-cli/<version> (external, cli)`. */
  version: string
  /** Sentence sent as the first system block. */
  identity: string
  /** Beta flag added to the request's `anthropic-beta` list. */
  beta: string
  /** 64-hex-digit device id for `metadata.user_id`; omission derives one from the host name. */
  deviceId?: string
}

/** Codex CLI emulation settings. */
export interface CodexEmulationConfig {
  /** Codex CLI version sent in the `version` header and the default `User-Agent`. */
  version: string
  /** Value of the `originator` header. */
  originator: string
  /** Complete `User-Agent`; omission renders `<originator>/<version> (<os> <release>; <arch>) <terminal>`. */
  userAgent?: string
  /** Terminal token at the end of the rendered `User-Agent`. */
  terminal: string
  /** Sentence prepended to the leading system or developer message. */
  identity: string
}

/** Plugin-level client emulation settings. */
export interface ClientEmulationConfig {
  /** Whether Anthropic routes emulate Claude Code and OpenAI routes emulate the Codex CLI. */
  enabled: boolean
  /** Settings for `anthropic-messages` routes. */
  claudeCode: ClaudeCodeEmulationConfig
  /** Settings for `openai-completions`, `openai-responses`, and `openai-codex-responses` routes. */
  codex: CodexEmulationConfig
}

const DEVICE_ID = /^[0-9a-f]{64}$/

/** Runtime schema for {@link ClientEmulationConfig}. */
export const ClientEmulationConfigSchema: z<ClientEmulationConfig> = z.object({
  enabled: z.boolean().default(false),
  claudeCode: z.object({
    version: z.string().default('2.1.280'),
    identity: z.string().default('You are Claude Code, Anthropic\'s official CLI for Claude.'),
    beta: z.string().default('claude-code-20250219'),
    deviceId: z.string().pattern(DEVICE_ID),
  }).default({}),
  codex: z.object({
    version: z.string().default('0.153.4'),
    originator: z.string().default('codex_cli_rs'),
    userAgent: z.string(),
    terminal: z.string().default('xterm-256color'),
    identity: z.string().default('You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user\'s computer.'),
  }).default({}),
})

/** The client a route emulates. */
export type EmulatedClient = 'claude-code' | 'codex'

/** Host facts the resolved emulation renders into identity values. */
export interface EmulationHostFacts {
  /** Host name the default Claude Code device id derives from. */
  hostname: string
  /** Operating system name for the Codex `User-Agent`, for example `Linux`. */
  osName: string
  /** Operating system release for the Codex `User-Agent`. */
  osRelease: string
  /** CPU architecture for the Codex `User-Agent`, for example `x86_64`. */
  arch: string
}

const OS_NAMES: Partial<Record<string, string>> = { darwin: 'Mac OS', linux: 'Linux', win32: 'Windows' }
const ARCH_NAMES: Partial<Record<string, string>> = { x64: 'x86_64' }

/**
 * Render Node process facts in the spelling the Codex CLI uses.
 * @param node - host name, `process.platform`, OS release, and `process.arch`.
 * @param node.hostname - host name.
 * @param node.platform - Node platform id.
 * @param node.release - operating system release.
 * @param node.arch - Node architecture id.
 * @returns host facts; unmapped platform and architecture ids pass through.
 */
export function emulationHostFacts(node: { hostname: string; platform: string; release: string; arch: string }): EmulationHostFacts {
  return {
    hostname: node.hostname,
    osName: OS_NAMES[node.platform] ?? node.platform,
    osRelease: node.release,
    arch: ARCH_NAMES[node.arch] ?? node.arch,
  }
}

/** Client emulation with every default resolved; present only when enabled. */
export interface ResolvedClientEmulation {
  /** Claude Code settings with the device id resolved. */
  claudeCode: Required<ClaudeCodeEmulationConfig>
  /** Codex settings with the `User-Agent` rendered. */
  codex: Required<CodexEmulationConfig>
  /** Session id sent by requests that carry no Harness session id. */
  processSessionId: string
}

/**
 * Resolve the emulation Config into request-ready values.
 * @param config - validated plugin emulation settings.
 * @param host - host facts for derived identity values.
 * @returns the resolved emulation, or undefined when emulation is disabled.
 */
export function resolveClientEmulation(
  config: ClientEmulationConfig,
  host: EmulationHostFacts,
): ResolvedClientEmulation | undefined {
  if (!config.enabled) return undefined
  const deviceId = config.claudeCode.deviceId
    ?? createHash('sha256').update(`dsh-claude-code-device\0${host.hostname}`).digest('hex')
  const userAgent = config.codex.userAgent
    ?? `${config.codex.originator}/${config.codex.version} (${host.osName} ${host.osRelease}; ${host.arch}) ${config.codex.terminal}`
  return {
    claudeCode: { ...config.claudeCode, deviceId },
    codex: { ...config.codex, userAgent },
    processSessionId: randomUUID(),
  }
}

/**
 * Select the emulated client from a route protocol.
 * @param api - the resolved model's wire protocol.
 * @returns the emulated client, or undefined for protocols without one.
 */
export function emulatedClientFor(api: Api): EmulatedClient | undefined {
  switch (api) {
    case 'anthropic-messages':
      return 'claude-code'
    case 'openai-completions':
    case 'openai-responses':
    case 'openai-codex-responses':
      return 'codex'
    default:
      return undefined
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * The UUID an emulated client sends as its session id: the UUID inside the
 * Harness session id, a UUID-formatted hash of a session id without one, or
 * the process session id for requests outside a session.
 * @param emulation - resolved emulation.
 * @param sessionId - Harness session id of the request, when any.
 * @returns a lowercase UUID string.
 */
export function emulatedSessionId(emulation: ResolvedClientEmulation, sessionId: string | undefined): string {
  if (sessionId === undefined) return emulation.processSessionId
  const embedded = UUID.exec(sessionId)?.[0]
  if (embedded !== undefined) return embedded.toLowerCase()
  const hex = createHash('sha256').update(sessionId).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Identity headers of the emulated client. A `null` value removes a header the
 * provider SDK would otherwise send.
 * @param emulation - resolved emulation.
 * @param client - the emulated client.
 * @param sessionUuid - session id from {@link emulatedSessionId}.
 * @returns headers that win over deployment and Harness attribution headers.
 */
export function emulationHeaders(
  emulation: ResolvedClientEmulation,
  client: EmulatedClient,
  sessionUuid: string,
): Record<string, string | null> {
  switch (client) {
    case 'claude-code':
      return {
        'user-agent': `claude-cli/${emulation.claudeCode.version} (external, cli)`,
        'x-app': 'cli',
        'x-claude-code-session-id': sessionUuid,
        'anthropic-dangerous-direct-browser-access': null,
      }
    case 'codex':
      return {
        'user-agent': emulation.codex.userAgent,
        originator: emulation.codex.originator,
        version: emulation.codex.version,
        session_id: sessionUuid,
      }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Prepend Claude Code's identity block, beta flag, and `metadata.user_id`. */
function claudeCodePayload(
  emulation: ResolvedClientEmulation,
  payload: Record<string, unknown>,
  sessionUuid: string,
): Record<string, unknown> {
  const { identity, beta, deviceId } = emulation.claudeCode
  const system = typeof payload.system === 'string'
    ? [{ type: 'text', text: payload.system }]
    : Array.isArray(payload.system) ? payload.system as unknown[] : []
  const first = system[0]
  const hasIdentity = isRecord(first) && first.text === identity
  const betas = Array.isArray(payload.betas) ? payload.betas as unknown[] : []
  return {
    ...payload,
    system: hasIdentity ? system : [{ type: 'text', text: identity }, ...system],
    betas: betas.includes(beta) ? betas : [beta, ...betas],
    metadata: {
      ...isRecord(payload.metadata) ? payload.metadata : {},
      user_id: JSON.stringify({ device_id: deviceId, account_uuid: '', session_id: sessionUuid }),
    },
  }
}

/** Prefix a leading instruction message's string content with the Codex identity. */
function withIdentityPrefix(message: unknown, identity: string): unknown {
  if (!isRecord(message) || (message.role !== 'system' && message.role !== 'developer')) return undefined
  if (typeof message.content !== 'string') return undefined
  if (message.content.startsWith(identity)) return message
  return { ...message, content: `${identity}\n\n${message.content}` }
}

/** Prepend the Codex identity to `instructions` or the leading instruction message. */
function codexPayload(emulation: ResolvedClientEmulation, payload: Record<string, unknown>): Record<string, unknown> {
  const { identity } = emulation.codex
  if (typeof payload.instructions === 'string') {
    return payload.instructions.startsWith(identity)
      ? payload
      : { ...payload, instructions: `${identity}\n\n${payload.instructions}` }
  }
  for (const field of ['input', 'messages'] as const) {
    const value = payload[field]
    if (!Array.isArray(value)) continue
    const list = value as unknown[]
    const prefixed = withIdentityPrefix(list[0], identity)
    const rest = list.slice(prefixed === undefined ? 0 : 1)
    return { ...payload, [field]: [prefixed ?? { role: 'system', content: identity }, ...rest] }
  }
  return payload
}

/**
 * Rewrite one provider request body for the emulated client.
 * @param emulation - resolved emulation.
 * @param client - the emulated client.
 * @param payload - the request body pi-ai built.
 * @param sessionUuid - session id from {@link emulatedSessionId}.
 * @returns the replacement body, or undefined to keep a body that is not a JSON object.
 */
export function emulationPayload(
  emulation: ResolvedClientEmulation,
  client: EmulatedClient,
  payload: unknown,
  sessionUuid: string,
): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined
  switch (client) {
    case 'claude-code':
      return claudeCodePayload(emulation, payload, sessionUuid)
    case 'codex':
      return codexPayload(emulation, payload)
  }
}

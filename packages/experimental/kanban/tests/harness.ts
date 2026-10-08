/** Kanban tests run the real service over memory storage and production Agents with a scripted model. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import KanbanService, { type Config } from '../src/index.ts'

/** One scripted model reply: plain text, a thrown failure, or text after a gate opens. */
export type Reply = { readonly kind: 'text' } | { readonly kind: 'fail' } | { readonly kind: 'gate'; readonly open: Promise<void> }

/** Model adapter that replays a reply queue and records every request's last user text. */
export class ScriptAdapter extends LlmAdapter {
  readonly prompts: string[] = []
  constructor(readonly replies: Reply[] = []) { super() }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const last = options.messages.findLast(message => message.role === 'user')
    this.prompts.push(last?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? '')
    const reply = this.replies.shift() ?? { kind: 'text' }
    if (reply.kind === 'fail') throw new Error('scripted model failure')
    if (reply.kind === 'gate') {
      const signal = options.signal
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => { reject(new Error('aborted')) }
        if (signal?.aborted === true) abort()
        signal?.addEventListener('abort', abort, { once: true })
        void reply.open.then(resolve)
      })
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Workspace used by every case. */
export const WORKSPACE = brandString<WorkspaceId>('ws-1')

/** A second, Session-less Workspace. */
export const OTHER_WORKSPACE = brandString<WorkspaceId>('ws-2')

/** Options of one harness instance. */
export interface HarnessOptions {
  readonly pool?: MemoryMediaPool
  readonly sessions?: readonly string[]
  readonly replies?: Reply[]
  readonly config?: Partial<Config>
  /** Workspace Sessions the Session Controller cannot resolve. */
  readonly ghosts?: readonly string[]
  /** Objects the Session Controller returns instead of a production Agent. */
  readonly stubs?: Readonly<Record<string, unknown>>
  /** Workspace Sessions whose resolution rejects. */
  readonly broken?: readonly string[]
  /** Whether a persistence listener acknowledges flushes; defaults to true. */
  readonly flush?: boolean
}

/**
 * Mount storage, a production agent loop with one Agent per Session, and the Kanban service.
 * @param options - shared media, Session ids, scripted replies, and config.
 * @returns the context, service, agents, adapter, and media pool.
 */
export async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  const adapter = new ScriptAdapter(options.replies)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  await ctx.plugin(Storage)
  const pool = options.pool ?? new MemoryMediaPool()
  const backend = new MemoryStorageBackend(pool)
  ctx.effect(() => ctx.storage.backend.register('fixture', backend))
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.effect(() => {
    const unmount = ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    return async () => { await facility.closeAll(); unmount() }
  })
  const ids = (options.sessions ?? ['s-1', 's-2']).map(id => SessionId(id))
  const agents = new Map<SessionId, Agent>()
  for (const id of ids) agents.set(id, await loop.create(id, { provider: 'mock', model: 'mock' }))
  const stubs = options.stubs ?? {}
  ctx.provide('sessionController', {
    resolveAgent: async (id: SessionId) => {
      if (options.broken?.includes(id) === true) throw new Error(`broken Session ${id}`)
      const agent = stubs[id] ?? agents.get(id)
      return agent === undefined ? { error: new Error(`missing Session ${id}`) } : { agent }
    },
  } as never)
  const members = [...ids, ...[...options.ghosts ?? [], ...options.broken ?? [], ...Object.keys(stubs)].map(id => SessionId(id))]
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === WORKSPACE ? { sessionIds: members } : id === OTHER_WORKSPACE ? { sessionIds: [] } : undefined,
  } as never)
  if (options.flush !== false) ctx.on('session/flush', () => {})
  ctx.provide('sessionPersistence', {} as never)
  await ctx.plugin(KanbanService, { maxTitleChars: 200, maxPromptChars: 20_000, attentionDelayMs: 20, ...options.config })
  return { ctx, service: ctx.kanban, agents, ids, adapter, pool }
}

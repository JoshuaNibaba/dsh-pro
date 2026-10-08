/** Authenticated server-status RPC channel and shared sampling lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Config } from './config.ts'
import { ServerSampler } from './sampler.ts'

export { Config } from './config.ts'
export type { ServerSnapshot } from './types.ts'

/** Stable Host plugin identity. */
export const name = 'client-ui-server-status'
/** Connection scopes authenticated RPC routes to this WebServer consumer fiber. */
export const inject = ['connection', 'webServer']

/** Start one server sampler and expose only aggregate numeric readings.
 * @param ctx Host plugin context.
 * @param config Schema-resolved sampling and request timing options.
 */
export function apply(ctx: Context, config: Config): void {
  const connection = ctx.connection
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSH_SERVER_STATUS_CONFIG__', value: config })
  })
  const sampler = new ServerSampler()
  ctx.effect(() => {
    sampler.sample()
    const timer = setInterval(() => { sampler.sample() }, config.sampleIntervalMs)
    return () => { clearInterval(timer) }
  })
  ctx.effect(() => connection.rpc.handle('/server-status', (endpoint) => {
    if (endpoint !== 'snapshot') {
      return Promise.resolve({ ok: false as const, error: { code: 'server-status/not-found', message: 'Unknown endpoint', details: {} } })
    }
    return Promise.resolve({ ok: true as const, value: sampler.snapshot() })
  }))
}

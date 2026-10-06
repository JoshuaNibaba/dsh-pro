/** Browser server-status registration and polling lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveConfig } from '../config.ts'
import type { Config } from '../config.ts'
import { en, zh } from './locale.ts'
import { StatusPoller } from './poller.ts'
import { StatusPills } from './StatusPills.tsx'

export { Config } from '../config.ts'
export type { StatusInjected, StatusProps } from './StatusPills.tsx'

/** Framework services consumed by this feature. */
export const inject = ['connection', 'slots', 'locale']

/** Bind authoritative connection state and private metric observations into the dock.
 * @param ctx Browser plugin context.
 * @param config Explicit Client Loader timings, used when no Host bootstrap payload exists.
 */
export function apply(ctx: Context, config: Config): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const bootstrap = (globalThis as { __DSH_SERVER_STATUS_CONFIG__?: unknown }).__DSH_SERVER_STATUS_CONFIG__
  const resolvedConfig = resolveConfig(bootstrap ?? config)
  const poller = new StatusPoller(connection, resolvedConfig)
  ctx.effect(() => ctx.locale.register('serverStatus', { en, zh }))
  ctx.effect(() => {
    poller.start()
    return async () => { await poller.stop() }
  })
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'server-status',
    order: 10,
    locale: 'serverStatus',
    inject: () => ({ hooks: { connectionState: connection.state, metrics: poller.metrics } }),
  }, StatusPills))
}

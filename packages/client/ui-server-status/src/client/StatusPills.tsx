/** Pure composer-dock presentation of framework-provided observations. */
import type { ConnectionStateSource } from '@deepseek-ai/dsh-client-connection/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MetricsReading } from './poller.ts'
import type {} from './locale.ts'
import css from './StatusPills.module.css'

/** Private observations bound into selector hooks by the slot renderer. */
export interface StatusInjected {
  hooks: {
    connectionState: ConnectionStateSource
    metrics: ObservableSnapshot<MetricsReading>
  }
}
/** All component inputs derive from the slot, locale and injection declarations. */
export type StatusProps = PropsRuntime<'conversation.composer.dock'> & InjectFace<StatusInjected> & PropsLocale<'serverStatus'>

/** Render OS-wide server readings and the current client's transport state.
 * @param props Framework-derived hooks and translation seat.
 * @returns Compact text readings that wrap inside narrow composers.
 */
export function StatusPills({ useConnectionState, useMetrics, t }: StatusProps) {
  const state = useConnectionState(value => value)
  const metrics = useMetrics(value => value)
  const connected = state === 'connected'
  const snapshot = connected ? metrics.snapshot : null
  const unavailable = t('unavailable')
  const cpu = snapshot?.cpuPercent
  const memory = snapshot?.memory
  const latency = connected ? metrics.latencyMs : null
  return <div className={css.root} aria-label={t('label')}>
    <span>{t(state ?? 'disconnected')}</span>
    <span>{t('cpu', { value: cpu == null ? unavailable : t('percent', { value: cpu.toFixed(1) }) })}</span>
    <span>{t('memory', { value: memory == null ? unavailable : t('gib', {
      used: (memory.usedBytes / 2 ** 30).toFixed(1),
      total: (memory.totalBytes / 2 ** 30).toFixed(1),
    }) })}</span>
    <span>{t('latency', { value: latency === null ? unavailable : t('milliseconds', { value: Math.round(latency) }) })}</span>
  </div>
}

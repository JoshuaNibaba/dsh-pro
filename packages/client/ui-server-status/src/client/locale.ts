/** Server-status-owned product strings and interpolation units. */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'

/** Translation keys in the serverStatus namespace. */
export type StatusKey = 'label' | 'connected' | 'connecting' | 'disconnected' | 'unavailable' | 'cpu' | 'memory' | 'latency' | 'percent' | 'gib' | 'milliseconds'

/** English dictionary. */
export const en: LocaleDictOf<'serverStatus'> = {
  label: 'DSH server status',
  connected: 'Connected',
  connecting: 'Reconnecting',
  disconnected: 'Disconnected',
  unavailable: 'Unavailable',
  cpu: 'Server CPU {value}',
  memory: 'Server memory {value}',
  percent: '{value}%',
  gib: '{used} / {total} GiB',
  milliseconds: '{value} ms',
  latency: 'Round trip {value}',
}

/** Simplified Chinese dictionary. */
export const zh: LocaleDictOf<'serverStatus'> = {
  label: 'DSH 服务器状态',
  connected: '已连接',
  connecting: '重新连接中',
  disconnected: '已断开',
  unavailable: '不可用',
  cpu: '服务器 CPU {value}',
  memory: '服务器内存 {value}',
  percent: '{value}%',
  gib: '{used} / {total} GiB',
  milliseconds: '{value} 毫秒',
  latency: '往返延迟 {value}',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Aggregate server readings and client connection status. */
    serverStatus: StatusKey
  }
}

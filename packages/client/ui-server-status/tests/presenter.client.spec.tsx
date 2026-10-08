// @vitest-environment jsdom
/** User-visible dock text, locale formats, unavailable readings and connection authority. */
import { createElement } from 'react'
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { StatusPills, type StatusProps } from '../src/client/StatusPills.tsx'
import { en, zh } from '../src/client/locale.ts'
import type { MetricsReading } from '../src/client/poller.ts'

afterEach(cleanup)

describe('server status pills', () => {
  it.each([['en', en], ['zh', zh]] as const)('renders measured server values in %s', (language, dictionary) => {
    const state = createSnapshotStore<ConnectionState | undefined>('connected')
    const metrics = createSnapshotStore<MetricsReading>({
      snapshot: { cpuPercent: 25, memory: { usedBytes: 2 ** 30, totalBytes: 4 * 2 ** 30 } },
      latencyMs: 41.6,
    })
    const props = {
      useConnectionState: bindSnapshotSelector(state),
      useMetrics: bindSnapshotSelector(metrics),
      t: makeTranslate(dictionary),
    } as StatusProps
    const view = render(createElement(StatusPills, props))
    expect(view.container.textContent).toBe(language === 'en'
      ? 'ConnectedServer CPU 25.0%Server memory 1.0 / 4.0 GiBRound trip 42 ms'
      : '已连接服务器 CPU 25.0%服务器内存 1.0 / 4.0 GiB往返延迟 42 毫秒')
    expect(view.container.firstElementChild?.getAttribute('aria-label')).toBe(dictionary.label)
    if (language === 'en') expect(view.container.textContent).toMatchInlineSnapshot('"ConnectedServer CPU 25.0%Server memory 1.0 / 4.0 GiBRound trip 42 ms"')
    else expect(view.container.textContent).toMatchInlineSnapshot('"已连接服务器 CPU 25.0%服务器内存 1.0 / 4.0 GiB往返延迟 42 毫秒"')
  })

  it.each(['connecting', 'disconnected', undefined] as const)('hides numeric facts when authoritative state is %j', (state) => {
    const connection = createSnapshotStore<ConnectionState | undefined>(state)
    const metrics = createSnapshotStore<MetricsReading>({ snapshot: { cpuPercent: 25, memory: null }, latencyMs: 42 })
    const view = render(createElement(StatusPills, {
      useConnectionState: bindSnapshotSelector(connection),
      useMetrics: bindSnapshotSelector(metrics),
      t: makeTranslate(en),
    } as StatusProps))
    expect(view.container.textContent).toContain(state === 'connecting' ? 'Reconnecting' : 'Disconnected')
    expect(view.container.textContent).not.toContain('25.0%')
    expect(view.container.textContent).not.toContain('42 ms')
    expect(view.container.textContent?.match(/Unavailable/g)).toHaveLength(3)
  })

  it('keeps connection status connected when metrics are unavailable', () => {
    const connection = createSnapshotStore<ConnectionState | undefined>('connected')
    const metrics = createSnapshotStore<MetricsReading>({ snapshot: { cpuPercent: null, memory: null }, latencyMs: null })
    const view = render(createElement(StatusPills, {
      useConnectionState: bindSnapshotSelector(connection),
      useMetrics: bindSnapshotSelector(metrics),
      t: makeTranslate(en),
    } as StatusProps))
    expect(view.container.textContent).toBe('ConnectedServer CPU UnavailableServer memory UnavailableRound trip Unavailable')
  })
})

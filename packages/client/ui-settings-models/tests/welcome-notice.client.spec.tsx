// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { Context } from '@deepseek-ai/cordis'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ConfigFormController } from '@deepseek-ai/dsh-client-ui-settings/src/client/config-form.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

/** Stateless schema service for scope construction in this jsdom fixture. */
const schemaService = new SettingsSchemaService(new Context())
import { WelcomeNotice } from '../src/client/WelcomeNotice.tsx'
import type { WelcomeNoticeProps } from '../src/client/WelcomeNotice.tsx'
import { decodeWelcomeSection, WelcomeNoticeStore } from '../src/client/welcome-store.ts'
import type { WelcomeSection } from '../src/client/welcome-store.ts'
import { en, zh } from '../src/client/locales.ts'
import { PRO_HIGHLIGHTS } from '../src/client/ProHighlights.tsx'
import {
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
} from '../src/onboarding-copy.ts'


afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

/** The settings namespace answers over the Remote carrier, which has no envelope. */
function remoteAnswer<T>(value: T) {
  return { ok: true as const, value }
}

function welcomeView(value: unknown, revision = 0) {
  return {
    ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
    schema: {},
    value,
    base: {},
    user: {},
    autoGenerate: true, applies: 'live' as const,
    secrets: [],
    revision,
  }
}

type AttentionSnapshot = Parameters<Parameters<WelcomeNoticeProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: WelcomeNoticeProps['useSessionStatus'] = selector => selector(noAttention)

function mount(
  version?: string,
  mutateImpl: () => Promise<unknown> = () =>
    Promise.resolve(remoteAnswer(welcomeView({ [WELCOME_NOTICE_ACK_FIELD]: WELCOME_NOTICE_VERSION }, 1))),
) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  const mutate = vi.fn(mutateImpl)
  const api = {
    settings: {
      describe: () => Promise.resolve(remoteAnswer({
        writable: true,
        hasDocument: false,
        namespaces: [welcomeView(version === undefined ? {} : { [WELCOME_NOTICE_ACK_FIELD]: version })],
      })),
      mutate,
    },
  }
  const ctx = { remote: api } as never
  const mirror = new SettingsDescribeMirror(ctx)
  const scope = new ConfigFormController<WelcomeSection>(
    ctx,
    { namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE, decode: decodeWelcomeSection },
    mirror,
    'host',
    schemaService,
  )
  const controller = new WelcomeNoticeStore(scope)
  void mirror.load()
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: WelcomeNoticeProps = {
    stepId: 'welcome-notice',
    complete,
    openSection: vi.fn(),
    useSessions: unusedHook,
    useSessionStatus,
    usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    useWorkspaces: unusedHook,
    controller,
    useWelcome: bindSnapshotSelector(controller.store),
    t: key => zh[key],
  }
  return { ...render(<WelcomeNotice {...props} />), complete, controller, mirror, mutate, appRoot }
}

const next = (): void => { fireEvent.click(screen.getByRole('button', { name: zh.welcomeNext })) }

describe('WelcomeNotice', () => {
  it('owns copy for every highlight page in both GUI locales', () => {
    expect(en.welcomeTitle).toBe('Welcome to DeepSeek Harness Pro')
    expect(zh.welcomeTitle).toBe('欢迎使用 DeepSeek Harness Pro')
    expect(PRO_HIGHLIGHTS.map(page => page.id)).toEqual(['overview', 'kanban', 'remote', 'status', 'speed'])
    for (const page of PRO_HIGHLIGHTS) {
      for (const key of [page.headingKey, page.bodyKey]) {
        expect(en[key].length).toBeGreaterThan(0)
        expect(zh[key]).not.toBe(en[key])
      }
    }
  })

  it('opens on the overview page with Skip and Next, focusing the title', async () => {
    const h = mount()
    const dialog = await screen.findByRole('dialog', { name: zh.welcomeTitle })
    expect(screen.getByRole('heading', { name: zh.welcomeOverviewHeading })).toBeTruthy()
    expect(screen.getByText(zh.welcomeOverviewBody, { exact: true })).toBeTruthy()
    expect([...dialog.querySelectorAll('button')].map(button => button.textContent)).toEqual([zh.welcomeSkip, zh.welcomeNext])
    expect(screen.getByRole('img', { name: '第 1 页，共 5 页' })).toBeTruthy()
    expect(dialog.querySelector('[data-highlight="overview"]')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText(zh.welcomeOverviewKanban, { exact: true })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: zh.welcomeTitle }))
    expect(h.appRoot.inert).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('[class*="mask"]')!)
    expect(h.complete).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('pages forward and back through every highlight without acknowledging', async () => {
    const h = mount()
    await screen.findByRole('dialog')
    next()
    expect(screen.getByRole('heading', { name: zh.welcomeKanbanHeading })).toBeTruthy()
    expect(screen.getByText(zh.welcomeKanbanTaskMoving, { exact: true })).toBeTruthy()
    expect(screen.getByRole('img', { name: '第 2 页，共 5 页' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.welcomeBack }))
    expect(screen.getByRole('heading', { name: zh.welcomeOverviewHeading })).toBeTruthy()
    next()
    next()
    expect(screen.getByText(zh.welcomeRemoteServer, { exact: true })).toBeTruthy()
    next()
    expect(screen.getByText(zh.welcomeStatusFileA, { exact: true })).toBeTruthy()
    expect(screen.getByText(zh.welcomeStatusLatency, { exact: true })).toBeTruthy()
    next()
    expect(screen.getByText(zh.welcomeSpeedSearch, { exact: true })).toBeTruthy()
    expect([...screen.getByRole('dialog').querySelectorAll('button')].map(button => button.textContent))
      .toEqual([zh.welcomeBack, zh.welcomeContinue])
    expect(h.mutate).not.toHaveBeenCalled()
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('acknowledges from the last page', async () => {
    const h = mount()
    await screen.findByRole('dialog')
    for (let page = 1; page < PRO_HIGHLIGHTS.length; page++) next()
    fireEvent.click(screen.getByRole('button', { name: zh.welcomeContinue }))
    await act(async () => { await Promise.resolve() })
    expect(h.mutate).toHaveBeenCalledOnce()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('requires a fresh acknowledgement after the official preview notice, and Skip acknowledges', async () => {
    const h = mount('2026-09-28.1')
    await screen.findByRole('dialog')
    next()
    fireEvent.click(screen.getByRole('button', { name: zh.welcomeSkip }))
    await act(async () => { await Promise.resolve() })
    expect(h.mutate).toHaveBeenCalledOnce()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('skips itself when this exact version was already acknowledged', async () => {
    const h = mount(WELCOME_NOTICE_VERSION)
    await act(async () => {
      await h.mirror.load()
      await h.controller.load()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('disables every action while saving and reports a refused write', async () => {
    let resolveWrite!: (value: unknown) => void
    const write = new Promise<unknown>((resolve) => { resolveWrite = resolve })
    const h = mount(undefined, () => write)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: zh.welcomeSkip }))
    for (const button of screen.getByRole('dialog').querySelectorAll('button')) expect(button.disabled).toBe(true)
    resolveWrite({
      ok: false,
      error: new RemoteError('settings/rejected', 'read only', { ns: WELCOME_NOTICE_SETTINGS_NAMESPACE }),
    })
    expect((await screen.findByRole('alert')).textContent).toBe(zh.welcomeError)
    expect(h.complete).not.toHaveBeenCalled()
  })
})

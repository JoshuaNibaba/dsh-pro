/** Source-safe lifecycle for the Kanban Remote namespace and its browser page. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-experimental-kanban/remote'
import type { KanbanBoard } from '@deepseek-ai/dsh-experimental-kanban/types'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { createBoardSource } from './board-source.ts'
import { KanbanIcon } from './KanbanIcon.tsx'
import { KanbanPage, type KanbanActionResult, type KanbanInjected } from './KanbanPage.tsx'
import { en, NS, zh, type KanbanKey } from './locales.ts'
import { createKanbanViewState } from './view-state.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Kanban board copy. */
    'kanban': KanbanKey
  }
}

const PANEL_ID = 'kanban' as MainPanelId

/** Browser services the page and its Remote calls require. */
export const inject = ['remote', 'slots', 'locale', 'sessions', 'uiWorkspace']

const outcome = async (call: Promise<RemoteResult<unknown>>): Promise<KanbanActionResult> => {
  const result = await call
  return result.ok ? { ok: true } : { ok: false, message: result.error.message }
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-kanban: dictionaries')
  const t = ctx.locale.bind(NS)
  const view = createKanbanViewState('dsh.kanban.view')
  const board = createBoardSource({
    selection: view.selection,
    open: workspaceId => ctx.remote.$stream<KanbanBoard>({
      name: 'Kanban board',
      open: signal => ctx.remote.kanban.follow(workspaceId, signal),
      ended: () => new RemoteStreamCarrierError('Kanban board stream ended'),
    }),
  })
  ctx.effect(() => () => board.dispose(), 'client-ui-kanban: board stream')

  const injected: KanbanInjected = {
    hooks: { board, view: view.store },
    selectWorkspace: (workspaceId) => { view.store.set({ ...view.store.getSnapshot(), workspaceId }) },
    setLaneCollapsed: (sessionId, collapsed) => {
      const current = view.store.getSnapshot()
      view.store.set({ ...current, collapsed: { ...current.collapsed, [sessionId]: collapsed } })
    },
    retryBoard: () => { board.retry() },
    createTask: (workspaceId, title, prompt) => outcome(ctx.remote.kanban.create({ workspaceId, title, prompt })),
    editTask: (id, title, prompt) => outcome(ctx.remote.kanban.edit({ id, title, prompt })),
    moveTask: (id, target) => outcome(ctx.remote.kanban.move({ id, target })),
    retryTask: id => outcome(ctx.remote.kanban.retry({ id })),
    skipTask: id => outcome(ctx.remote.kanban.skip({ id })),
    deleteTask: id => outcome(ctx.remote.kanban.delete({ id })),
    newSession: async (workspaceId) => {
      try {
        await ctx.sessions.create({ workspaceId })
        return { ok: true }
      } catch (error: unknown) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
    openSession: (sessionId) => { ctx.uiWorkspace.openSession(sessionId) },
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS, inject: () => injected,
  }, KanbanPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 11, locale: NS, label: () => t('panel'),
  }, KanbanIcon))
}

/**
 * Mount the Kanban namespace without adding it to stable API Remotes, then register the page.
 * @param ctx - Client runtime owning the Remote, dictionaries, and slots.
 * @param contribution - generated Kanban Remote definitions.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function mountKanban(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.kanban', 'slots', 'locale', 'sessions', 'uiWorkspace'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}

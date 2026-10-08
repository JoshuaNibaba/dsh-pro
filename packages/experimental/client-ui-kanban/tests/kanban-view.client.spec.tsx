// @vitest-environment jsdom
/** The board View renders the three columns and turns gestures into Kanban actions. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KanbanTask, KanbanTaskId, KanbanTaskStatus } from '@deepseek-ai/dsh-experimental-kanban/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardSnapshot } from '../src/client/board-source.ts'
import { KanbanView as KanbanBoardView } from '../src/client/KanbanView.tsx'
import { en } from '../src/client/locales.ts'
import type { KanbanView } from '../src/client/view-state.ts'

afterEach(cleanup)

const WS1 = brandString<WorkspaceId>('ws-1')
const WS2 = brandString<WorkspaceId>('ws-2')
const S1 = brandString<SessionId>('s-1')
const S2 = brandString<SessionId>('s-2')
const S3 = brandString<SessionId>('s-3')
const NOW = '2026-10-08T00:00:00.000Z'

function task(id: string, status: KanbanTaskStatus, extra: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: brandString<KanbanTaskId>(id), workspaceId: WS1, title: `title ${id}`, prompt: '', status, rank: 0,
    createdAt: NOW, updatedAt: NOW, ...status === 'draft' ? {} : { sessionId: S1 }, ...extra,
  }
}

const t = (key: keyof typeof en, params: Record<string, unknown> = {}): string =>
  en[key].replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name]))

interface Setup {
  readonly tasks?: readonly KanbanTask[]
  readonly board?: Partial<BoardSnapshot>
  readonly view?: Partial<KanbanView>
  readonly workspaces?: readonly { workspaceId: WorkspaceId; title: string; sessionIds: SessionId[] }[]
  readonly fail?: boolean
  /** Session whose View renders; defaults to the first lane Session. */
  readonly sessionId?: SessionId
}

function setup(options: Setup = {}) {
  const ok = async () => options.fail === true ? { ok: false as const, message: 'nope' } : { ok: true as const }
  const actions = {
    selectWorkspace: vi.fn(),
    setLaneCollapsed: vi.fn(),
    retryBoard: vi.fn(),
    createTask: vi.fn(ok),
    editTask: vi.fn(ok),
    moveTask: vi.fn(ok),
    retryTask: vi.fn(ok),
    skipTask: vi.fn(ok),
    deleteTask: vi.fn(ok),
    newSession: vi.fn(ok),
    openSession: vi.fn(),
  }
  const workspaces = {
    items: options.workspaces ?? [
      { workspaceId: WS1, title: 'Alpha', sessionIds: [S1, S2, S3] },
      { workspaceId: WS2, title: 'Beta', sessionIds: [] },
    ],
    archivedSessionIds: [S3],
  }
  const sessions = {
    byId: {
      [S1]: { title: 'Lane one', running: true },
      [S2]: { title: '  ', running: false },
    },
  }
  const board: BoardSnapshot = {
    workspaceId: WS1, status: 'ready', board: { workspaceId: WS1, tasks: options.tasks ?? [] }, error: null, ...options.board,
  }
  const view: KanbanView = { workspaceId: WS1, collapsed: {}, ...options.view }
  const select = <S, R>(state: S) => (selector: (value: S) => R) => selector(state)
  const props = {
    t,
    sessionId: options.sessionId ?? S1,
    useWorkspaces: select(workspaces),
    useSessions: select(sessions),
    useBoard: select(board),
    useView: select(view),
    ...actions,
  }
  const result = render(<KanbanBoardView {...props as Parameters<typeof KanbanBoardView>[0]} />)
  return { ...actions, ...result }
}

/** Minimal DataTransfer for HTML drag events in jsdom. */
function transfer() {
  const data = new Map<string, string>()
  return {
    types: [] as string[],
    effectAllowed: '',
    dropEffect: '',
    setData(type: string, value: string) { data.set(type, value); this.types.push(type) },
    getData: (type: string) => data.get(type) ?? '',
  }
}

const flush = () => act(async () => { await Promise.resolve() })

describe('KanbanView', () => {
  it('lays out the plan, lanes, and finished tasks of the selected Workspace', () => {
    setup({ tasks: [
      task('p', 'draft', { prompt: 'details' }),
      task('w', 'waiting'),
      task('r', 'running'),
      task('d', 'done', { finishedAt: NOW }),
      task('k', 'skipped', { finishedAt: NOW, failure: { reason: 'error', message: 'x' } }),
      task('orphan', 'waiting', { sessionId: brandString<SessionId>('s-9') }),
      task('unbound', 'done', { finishedAt: NOW, sessionId: undefined }),
    ] })
    expect(within(screen.getByTestId('kanban-column-plan')).getByText('title p')).toBeTruthy()
    expect(screen.getByText('details')).toBeTruthy()
    const lane = screen.getByTestId('kanban-lane-s-1')
    expect(within(lane).getByText('Lane one')).toBeTruthy()
    expect(within(lane).getByText('title w')).toBeTruthy()
    expect(within(lane).getByText('2 tasks')).toBeTruthy()
    expect(screen.getByTestId('kanban-lane-s-9')).toBeTruthy()
    expect(screen.queryByTestId('kanban-lane-s-3')).toBeNull()
    expect(within(screen.getByTestId('kanban-column-done')).getByText('title d')).toBeTruthy()
    expect(within(screen.getByTestId('kanban-task-unbound')).queryByRole('button', { name: en['action.openSession'] })).toBeNull()
    expect(screen.getByText('Run failed: x')).toBeTruthy()
    // The empty, idle second lane starts folded and shows an untitled label.
    const idle = screen.getByTestId('kanban-lane-s-2')
    expect(within(idle).getByRole('button', { name: 'Expand Untitled session' })).toBeTruthy()
    expect(within(idle).queryByText(en['lane.empty'])).toBeNull()
  })

  it('follows the Workspace that holds the current Session', () => {
    const { selectWorkspace } = setup({ view: { workspaceId: WS2 } })
    expect(selectWorkspace).toHaveBeenCalledWith(WS1)
    cleanup()
    const settled = setup()
    expect(settled.selectWorkspace).not.toHaveBeenCalled()
  })

  it('shows empty states and loading copy', () => {
    setup({ board: { status: 'loading', board: null } })
    expect(screen.getByText(en['board.loading'])).toBeTruthy()
    expect(screen.getByText(en['done.empty'])).toBeTruthy()
    cleanup()
    setup({ sessionId: S3, workspaces: [{ workspaceId: WS1, title: 'Alpha', sessionIds: [S3] }] })
    expect(screen.getByText(en['plan.empty'])).toBeTruthy()
    expect(screen.getByText(en['run.empty'])).toBeTruthy()
    cleanup()
    setup({ workspaces: [] })
    expect(screen.getByText(en['workspace.none'])).toBeTruthy()
    cleanup()
    setup({ board: { workspaceId: WS2 } })
    expect(screen.getByText(en['plan.empty'])).toBeTruthy()
  })

  it('creates and edits tasks through the editor', async () => {
    const { createTask, editTask } = setup({ tasks: [task('p', 'draft', { prompt: 'old' })] })
    fireEvent.click(screen.getByRole('button', { name: en['plan.new'] }))
    const create = screen.getByRole('button', { name: en['editor.create'] })
    expect((create as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(en['editor.titlePlaceholder']), { target: { value: 'New' } })
    fireEvent.change(screen.getByPlaceholderText(en['editor.promptPlaceholder']), { target: { value: 'More' } })
    fireEvent.click(screen.getByRole('button', { name: en['editor.create'] }))
    await flush()
    expect(createTask).toHaveBeenCalledWith(WS1, 'New', 'More')
    expect(screen.queryByPlaceholderText(en['editor.titlePlaceholder'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en['action.edit'] }))
    expect(screen.getByText(en['editor.editTitle'])).toBeTruthy()
    fireEvent.submit(screen.getByPlaceholderText(en['editor.titlePlaceholder']).closest('form')!)
    await flush()
    expect(editTask).toHaveBeenCalledWith(brandString('p'), 'title p', 'old')
    fireEvent.click(screen.getByRole('button', { name: en['plan.new'] }))
    fireEvent.submit(screen.getByPlaceholderText(en['editor.titlePlaceholder']).closest('form')!)
    expect(createTask).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: en['editor.cancel'] }))
    expect(screen.queryByPlaceholderText(en['editor.titlePlaceholder'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en['plan.new'] }))
    fireEvent.click(screen.getByRole('button', { name: en['editor.close'] }))
    expect(screen.queryByPlaceholderText(en['editor.titlePlaceholder'])).toBeNull()
  })

  it('keeps the editor open and reports a refused save', async () => {
    const { createTask } = setup({ fail: true })
    fireEvent.click(screen.getByRole('button', { name: en['plan.new'] }))
    fireEvent.change(screen.getByPlaceholderText(en['editor.titlePlaceholder']), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: en['editor.create'] }))
    await flush()
    expect(createTask).toHaveBeenCalled()
    await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Action failed: nope') })
    expect(screen.getByPlaceholderText(en['editor.titlePlaceholder'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['error.dismiss'] }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('moves dragged tasks into a lane, before a plan card, or back to the plan', () => {
    const { moveTask } = setup({ tasks: [task('a', 'draft'), task('b', 'draft'), task('w', 'waiting'), task('r', 'running')] })
    const drag = (id: string) => {
      const dataTransfer = transfer()
      fireEvent.dragStart(screen.getByTestId(`kanban-task-${id}`), { dataTransfer })
      return dataTransfer
    }
    let dataTransfer = drag('a')
    expect(screen.getByTestId('kanban-task-a').className).toMatch(/dragging/)
    const lane = screen.getByTestId('kanban-lane-s-1')
    fireEvent.dragOver(lane, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('move')
    fireEvent.drop(lane, { dataTransfer })
    expect(moveTask).toHaveBeenLastCalledWith('a', { kind: 'lane', sessionId: S1 })
    dataTransfer = drag('b')
    fireEvent.dragOver(screen.getByTestId('kanban-task-a'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('kanban-task-a'), { dataTransfer })
    expect(moveTask).toHaveBeenLastCalledWith('b', { kind: 'plan', beforeId: 'a' })
    dataTransfer = drag('w')
    expect(screen.getByTestId('kanban-column-plan').className).toMatch(/dropTarget/)
    fireEvent.drop(screen.getByTestId('kanban-column-plan'), { dataTransfer })
    expect(moveTask).toHaveBeenLastCalledWith('w', { kind: 'plan' })
    fireEvent.dragEnd(screen.getByTestId('kanban-task-w'))
    expect(screen.getByTestId('kanban-task-r').getAttribute('draggable')).toBeNull()
    // Foreign drags and empty payloads are ignored.
    const foreign = { types: ['text/plain'], getData: () => '', dropEffect: '' }
    fireEvent.dragOver(lane, { dataTransfer: foreign })
    fireEvent.drop(lane, { dataTransfer: foreign })
    const empty = { types: ['application/x-dsh-kanban-task'], getData: () => '', dropEffect: '' }
    fireEvent.drop(lane, { dataTransfer: empty })
    expect(moveTask).toHaveBeenCalledTimes(3)
  })

  it('offers retry, skip, withdraw, delete, and navigation on the matching cards', () => {
    const actions = setup({
      tasks: [task('f', 'failed', { failure: { reason: 'aborted' } }), task('d', 'done', { finishedAt: NOW }), task('a', 'attention')],
      view: { collapsed: { [S1]: false } },
    })
    const failed = screen.getByTestId('kanban-task-f')
    expect(within(failed).getByText(en['failure.aborted'])).toBeTruthy()
    expect(screen.getByText(en['lane.paused'])).toBeTruthy()
    fireEvent.click(within(failed).getByRole('button', { name: en['action.retry'] }))
    fireEvent.click(within(failed).getByRole('button', { name: en['action.skip'] }))
    fireEvent.click(within(failed).getByRole('button', { name: en['action.toPlan'] }))
    fireEvent.click(within(failed).getByRole('button', { name: en['action.delete'] }))
    expect(actions.retryTask).toHaveBeenCalledWith('f')
    expect(actions.skipTask).toHaveBeenCalledWith('f')
    expect(actions.moveTask).toHaveBeenCalledWith('f', { kind: 'plan' })
    expect(actions.deleteTask).toHaveBeenCalledWith('f')
    const done = screen.getByTestId('kanban-task-d')
    fireEvent.click(within(done).getByRole('button', { name: en['action.openSession'] }))
    expect(actions.openSession).toHaveBeenCalledWith(S1)
    expect(within(screen.getByTestId('kanban-task-a')).queryByRole('button')).toBeNull()
  })

  it('folds lanes, opens their Session, and starts a new Session', () => {
    const actions = setup({ tasks: [task('w', 'waiting')] })
    const lane = screen.getByTestId('kanban-lane-s-1')
    fireEvent.click(within(lane).getByRole('button', { name: 'Collapse Lane one' }))
    expect(actions.setLaneCollapsed).toHaveBeenCalledWith(S1, true)
    fireEvent.click(within(screen.getByTestId('kanban-lane-s-2')).getByRole('button', { name: 'Expand Untitled session' }))
    expect(actions.setLaneCollapsed).toHaveBeenCalledWith(S2, false)
    fireEvent.click(within(lane).getByRole('button', { name: en['lane.open'] }))
    expect(actions.openSession).toHaveBeenCalledWith(S1)
    fireEvent.click(screen.getByRole('button', { name: en['run.newSession'] }))
    expect(actions.newSession).toHaveBeenCalledWith(WS1)
    cleanup()
    setup({ view: { collapsed: { [S2]: false } } })
    expect(within(screen.getByTestId('kanban-lane-s-2')).getByText(en['lane.empty'])).toBeTruthy()
  })

  it('shows a board failure with a retry action', () => {
    const { retryBoard } = setup({ board: { status: 'error', error: 'offline' } })
    expect(screen.getByText('Could not load the board: offline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['board.retry'] }))
    expect(retryBoard).toHaveBeenCalled()
    cleanup()
    setup({ board: { status: 'error', error: null } })
    expect(screen.getByRole('alert').textContent).toContain('Could not load the board:')
  })

})

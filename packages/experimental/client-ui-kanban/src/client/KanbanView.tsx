/** The Kanban Conversation View: plan pool, Session lanes, and completed tasks of the Session's Workspace. */
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconEditOutlineRegular, IconPlusOutlineRegular,
  IconRefreshOutlineRegular, IconRightUpOutlineRegular, IconTrashOutlineRegular, IconCloseOutlineRegular, Input,
  Modal, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, HostObservable, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { KanbanMoveTarget, KanbanTask, KanbanTaskId, KanbanTaskStatus } from '@deepseek-ai/dsh-experimental-kanban/types'
import type { BoardSnapshot } from './board-source.ts'
import type { KanbanView } from './view-state.ts'
import css from './KanbanView.module.css'

/** Outcome of one Host mutation as the page reports it. */
export type KanbanActionResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** Data sources and callbacks the View receives from its registration. */
export interface KanbanInjected {
  readonly hooks: {
    readonly board: HostObservable<BoardSnapshot>
    readonly view: HostObservable<KanbanView>
  }
  readonly selectWorkspace: (workspaceId: WorkspaceId) => void
  readonly setLaneCollapsed: (sessionId: SessionId, collapsed: boolean) => void
  readonly retryBoard: () => void
  readonly createTask: (workspaceId: WorkspaceId, title: string, prompt: string) => Promise<KanbanActionResult>
  readonly editTask: (id: KanbanTaskId, title: string, prompt: string) => Promise<KanbanActionResult>
  readonly moveTask: (id: KanbanTaskId, target: KanbanMoveTarget) => Promise<KanbanActionResult>
  readonly retryTask: (id: KanbanTaskId) => Promise<KanbanActionResult>
  readonly skipTask: (id: KanbanTaskId) => Promise<KanbanActionResult>
  readonly deleteTask: (id: KanbanTaskId) => Promise<KanbanActionResult>
  readonly newSession: (workspaceId: WorkspaceId) => Promise<KanbanActionResult>
  readonly openSession: (sessionId: SessionId) => void
}

/** Conversation View props derived from the framework seats and the injected face. */
export type KanbanViewProps = PropsRuntime<'conversation.view'> & InjectFace<KanbanInjected> & PropsLocale<'kanban'>

type T = KanbanViewProps['t']

/** Drag payload type; only Kanban cards carry it. */
const DRAG_TYPE = 'application/x-dsh-kanban-task'

const STATUS_DOT: Record<KanbanTaskStatus, 'idle' | 'ongoing' | 'warning' | 'error' | 'done'> = {
  draft: 'idle', waiting: 'idle', running: 'ongoing', attention: 'warning', failed: 'error', done: 'done', skipped: 'idle',
}

const MOVABLE: ReadonlySet<KanbanTaskStatus> = new Set(['draft', 'waiting', 'failed'])

/** Open editor: a new task for a Workspace, or an existing task. */
type EditorState =
  | { readonly mode: 'create'; readonly workspaceId: WorkspaceId; readonly title: string; readonly prompt: string }
  | { readonly mode: 'edit'; readonly id: KanbanTaskId; readonly title: string; readonly prompt: string }

/**
 * Render the board of the Workspace that holds the current Session.
 * @param props - Session and Workspace seats, board and view hooks, mutation callbacks, and copy.
 * @returns the three-column board.
 */
export function KanbanView(props: KanbanViewProps) {
  const { t, sessionId, useWorkspaces, useSessions, useBoard, useView } = props
  const workspaces = useWorkspaces(state => state)
  const sessions = useSessions(state => state.byId)
  const board = useBoard(state => state)
  const view = useView(state => state)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [dragging, setDragging] = useState<KanbanTaskId | null>(null)

  const selected = workspaces.items.find(item => item.sessionIds.includes(sessionId))
  useEffect(() => {
    if (selected !== undefined && selected.workspaceId !== view.workspaceId) props.selectWorkspace(selected.workspaceId)
  }, [selected?.workspaceId, view.workspaceId])

  const tasks = board.workspaceId === selected?.workspaceId ? board.board?.tasks ?? [] : []
  const plan = tasks.filter(task => task.status === 'draft')
  const finished = tasks.filter(task => task.status === 'done' || task.status === 'skipped')
  const laneIds = useMemo(() => {
    if (selected === undefined) return []
    const archived = new Set(workspaces.archivedSessionIds)
    const ids = selected.sessionIds.filter(id => !archived.has(id) && sessions[id]?.origin !== 'subagent')
    for (const task of tasks) {
      if (task.sessionId !== undefined && task.status !== 'draft' && task.status !== 'done' && task.status !== 'skipped'
        && !ids.includes(task.sessionId)) ids.push(task.sessionId)
    }
    return ids
  }, [selected, workspaces.archivedSessionIds, sessions, tasks])

  const run = async (operation: Promise<KanbanActionResult>, onSuccess?: () => void): Promise<void> => {
    const result = await operation
    if (result.ok) onSuccess?.()
    else setError(result.message)
  }

  const draggedTask = tasks.find(task => task.id === dragging)
  const acceptsDrop = (event: DragEvent): boolean => event.dataTransfer.types.includes(DRAG_TYPE)
  const dropTo = (target: KanbanMoveTarget) => (event: DragEvent): void => {
    if (!acceptsDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    const id = event.dataTransfer.getData(DRAG_TYPE) as KanbanTaskId
    setDragging(null)
    if (id !== '') void run(props.moveTask(id, target))
  }
  const allowDrop = (event: DragEvent): void => {
    if (!acceptsDrop(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }
  const dragProps = (task: KanbanTask) => MOVABLE.has(task.status)
    ? {
      draggable: true,
      onDragStart: (event: DragEvent) => {
        event.dataTransfer.setData(DRAG_TYPE, task.id)
        event.dataTransfer.effectAllowed = 'move'
        setDragging(task.id)
      },
      onDragEnd: () => { setDragging(null) },
    }
    : {}

  const saveEditor = async (state: EditorState): Promise<void> => {
    const close = (): void => { setEditor(null) }
    await (state.mode === 'create'
      ? run(props.createTask(state.workspaceId, state.title, state.prompt), close)
      : run(props.editTask(state.id, state.title, state.prompt), close))
  }

  const cardActions = (task: KanbanTask): ReactNode => {
    const { sessionId } = task
    return (
      <>
        {(task.status === 'draft' || task.status === 'waiting' || task.status === 'failed') && (
          <IconAction label={t('action.edit')} onClick={() => { setEditor({ mode: 'edit', id: task.id, title: task.title, prompt: task.prompt }) }}>
            <IconEditOutlineRegular size={14} />
          </IconAction>
        )}
        {task.status === 'failed' && (
          <>
            <IconAction label={t('action.retry')} onClick={() => { void run(props.retryTask(task.id)) }}>
              <IconRefreshOutlineRegular size={14} />
            </IconAction>
            <Button size="sm" variant="ghost" className={css.textAction} onClick={() => { void run(props.skipTask(task.id)) }}>{t('action.skip')}</Button>
            <Button size="sm" variant="ghost" className={css.textAction} onClick={() => { void run(props.moveTask(task.id, { kind: 'plan' })) }}>{t('action.toPlan')}</Button>
          </>
        )}
        {(task.status === 'done' || task.status === 'skipped') && sessionId !== undefined && (
          <IconAction label={t('action.openSession')} onClick={() => { props.openSession(sessionId) }}>
            <IconRightUpOutlineRegular size={14} />
          </IconAction>
        )}
        {task.status !== 'running' && task.status !== 'attention' && (
          <IconAction label={t('action.delete')} onClick={() => { void run(props.deleteTask(task.id)) }}>
            <IconTrashOutlineRegular size={14} />
          </IconAction>
        )}
      </>
    )
  }

  const card = (task: KanbanTask, planDrop = false): ReactNode => (
    <article
      key={task.id}
      className={clsx(css.card, css[`status-${task.status}`], dragging === task.id && css.dragging)}
      data-testid={`kanban-task-${task.id}`}
      data-status={task.status}
      {...dragProps(task)}
      {...planDrop ? { onDragOver: allowDrop, onDrop: dropTo({ kind: 'plan', beforeId: task.id }) } : {}}
    >
      <div className={css.cardHead}>
        <StateDot state={STATUS_DOT[task.status]} />
        <span className={css.cardStatus}>{t(`status.${task.status}`)}</span>
        <span className={css.cardActions}>{cardActions(task)}</span>
      </div>
      <div className={css.cardTitle}>{task.title}</div>
      {task.prompt !== '' && <div className={css.cardPrompt}>{task.prompt}</div>}
      {task.failure !== undefined && (
        <div className={css.cardFailure}>
          {t(`failure.${task.failure.reason}`)}
          {task.failure.message !== undefined && `: ${task.failure.message}`}
        </div>
      )}
    </article>
  )

  return (
    <section className={css.page} aria-label={t('title')} data-testid="kanban-page">
      {error !== null && (
        <div className={css.notice} role="alert">
          <span>{t('error.action', { message: error })}</span>
          <IconAction label={t('error.dismiss')} onClick={() => { setError(null) }}><IconCloseOutlineRegular size={14} /></IconAction>
        </div>
      )}
      {board.status === 'error' && (
        <div className={css.notice} role="alert">
          <span>{t('board.error', { message: board.error ?? '' })}</span>
          <Button size="sm" variant="outline" onClick={props.retryBoard}>{t('board.retry')}</Button>
        </div>
      )}
      {selected !== undefined && (
        <div className={css.columns}>
          <Column
            title={t('column.plan')}
            count={plan.length}
            action={(
              <Button size="sm" variant="ghost" icon={<IconPlusOutlineRegular size={14} />}
                onClick={() => { setEditor({ mode: 'create', workspaceId: selected.workspaceId, title: '', prompt: '' }) }}>{t('plan.new')}</Button>
            )}
            onDragOver={allowDrop}
            onDrop={dropTo({ kind: 'plan' })}
            highlight={draggedTask !== undefined && draggedTask.status !== 'draft'}
            testId="kanban-column-plan"
          >
            {plan.length === 0 && <p className={css.empty}>{board.status === 'loading' ? t('board.loading') : t('plan.empty')}</p>}
            {plan.map(task => card(task, true))}
          </Column>
          <Column
            title={t('column.run')}
            count={tasks.filter(task => task.sessionId !== undefined && !['done', 'skipped'].includes(task.status)).length}
            action={(
              <Button size="sm" variant="ghost" icon={<IconPlusOutlineRegular size={14} />}
                onClick={() => { void run(props.newSession(selected.workspaceId)) }}>{t('run.newSession')}</Button>
            )}
            testId="kanban-column-run"
          >
            {laneIds.length === 0 && <p className={css.empty}>{t('run.empty')}</p>}
            {laneIds.map((sessionId) => {
              const lane = tasks.filter(task => task.sessionId === sessionId && ['waiting', 'running', 'attention', 'failed'].includes(task.status))
              const summary = sessions[sessionId]
              const running = summary?.running === true
              const title = summary?.title?.trim() === '' || summary?.title === undefined ? t('lane.untitled') : summary.title
              const collapsed = view.collapsed[sessionId] ?? (lane.length === 0 && !running)
              const paused = lane.some(task => task.status === 'failed')
              return (
                <div key={sessionId} className={clsx(css.lane, paused && css.lanePaused)}
                  data-testid={`kanban-lane-${sessionId}`}
                  onDragOver={allowDrop} onDrop={dropTo({ kind: 'lane', sessionId })}>
                  <div className={css.laneHead}>
                    <button type="button" className={css.laneToggle} aria-expanded={!collapsed}
                      aria-label={t(collapsed ? 'lane.expand' : 'lane.collapse', { title })}
                      onClick={() => { props.setLaneCollapsed(sessionId, !collapsed) }}>
                      {collapsed ? <IconChevronRightOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}
                      <StateDot state={running ? 'ongoing' : 'idle'} />
                      <span className={css.laneTitle}>{title}</span>
                      <span className={css.laneCount}>{t('lane.count', { n: lane.length })}</span>
                    </button>
                    <IconAction label={t('lane.open')} onClick={() => { props.openSession(sessionId) }}>
                      <IconRightUpOutlineRegular size={14} />
                    </IconAction>
                  </div>
                  {paused && !collapsed && <p className={css.lanePausedText}>{t('lane.paused')}</p>}
                  {!collapsed && (
                    <div className={css.laneBody}>
                      {lane.length === 0 && <p className={css.empty}>{t('lane.empty')}</p>}
                      {lane.map(task => card(task))}
                    </div>
                  )}
                </div>
              )
            })}
          </Column>
          <Column title={t('column.done')} count={finished.length} testId="kanban-column-done">
            {finished.length === 0 && <p className={css.empty}>{t('done.empty')}</p>}
            {finished.map(task => card(task))}
          </Column>
        </div>
      )}
      {selected === undefined && <p className={css.empty}>{t('workspace.none')}</p>}
      <TaskEditor t={t} state={editor} onChange={setEditor} onSave={(state) => { void saveEditor(state) }} />
    </section>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={css.iconAction} aria-label={label} title={label}
      onClick={(event) => { event.stopPropagation(); onClick() }}>
      {children}
    </button>
  )
}

function Column({ title, count, action, children, onDragOver, onDrop, highlight = false, testId }: {
  title: string
  count: number
  action?: ReactNode
  children: ReactNode
  onDragOver?: (event: DragEvent) => void
  onDrop?: (event: DragEvent) => void
  highlight?: boolean
  testId: string
}) {
  return (
    <div className={clsx(css.column, highlight && css.dropTarget)} data-testid={testId}
      {...onDragOver === undefined ? {} : { onDragOver }} {...onDrop === undefined ? {} : { onDrop }}>
      <div className={css.columnHead}>
        <h2 className={css.columnTitle}>{title}</h2>
        <span className={css.columnCount}>{count}</span>
        <span className={css.columnAction}>{action}</span>
      </div>
      <div className={css.columnBody}>{children}</div>
    </div>
  )
}

function TaskEditor({ t, state, onChange, onSave }: {
  t: T
  state: EditorState | null
  onChange: (next: EditorState | null) => void
  onSave: (state: EditorState) => void
}) {
  const canSave = state !== null && state.title.trim() !== ''
  const save = (): void => { if (state !== null && canSave) onSave(state) }
  return (
    <Modal
      open={state !== null}
      onClose={() => { onChange(null) }}
      title={state?.mode === 'edit' ? t('editor.editTitle') : t('editor.createTitle')}
      closeLabel={t('editor.close')}
      className={clsx(css.editorDialog)}
      footer={(
        <div className={css.editorFooter}>
          <Button size="sm" variant="ghost" onClick={() => { onChange(null) }}>{t('editor.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={!canSave} onClick={save}>
            {state?.mode === 'edit' ? t('editor.save') : t('editor.create')}
          </Button>
        </div>
      )}
    >
      {state !== null && (
        <form className={css.editor} onSubmit={(event) => { event.preventDefault(); save() }}>
          <label className={css.field}>
            <span>{t('editor.titleLabel')}</span>
            <Input className={clsx(css.titleInput)} data-modal-autofocus value={state.title} placeholder={t('editor.titlePlaceholder')}
              onChange={(event) => { onChange({ ...state, title: event.target.value }) }} />
          </label>
          <label className={css.field}>
            <span>{t('editor.promptLabel')}</span>
            <textarea className={css.textarea} rows={6} value={state.prompt} placeholder={t('editor.promptPlaceholder')}
              onChange={(event) => { onChange({ ...state, prompt: event.target.value }) }} />
          </label>
        </form>
      )}
    </Modal>
  )
}

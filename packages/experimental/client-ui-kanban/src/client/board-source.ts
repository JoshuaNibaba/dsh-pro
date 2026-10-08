/**
 * One Host board mirror for the selected Workspace. The mirror follows the
 * Host only while the page subscribes, and reopens when the selection changes.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { KanbanBoard } from '@deepseek-ai/dsh-experimental-kanban/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Board state shown by the page. */
export interface BoardSnapshot {
  /** Workspace the board belongs to; null before a Workspace is selected. */
  readonly workspaceId: WorkspaceId | null
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** Last board received for `workspaceId`. */
  readonly board: KanbanBoard | null
  /** Failure text while `status` is `error`. */
  readonly error: string | null
}

/** One reconnecting follow stream of a Workspace board. */
export interface BoardStream extends AsyncIterable<{ readonly value: KanbanBoard; accept(): void }> {
  dispose(): Promise<void>
}

/** Remote and selection inputs of the mirror. */
export interface BoardSourceDeps {
  /** Selected Workspace, owned by the persisted view state. */
  readonly selection: ObservableSnapshot<WorkspaceId | null>
  /** Open the Host follow stream for one Workspace. */
  readonly open: (workspaceId: WorkspaceId) => BoardStream
}

/** Observable board plus its lifecycle controls. */
export interface BoardSource extends ObservableSnapshot<BoardSnapshot> {
  /** Reopen the stream after a failure. */
  retry(): void
  /** Stop following and wait for the stream to close. */
  dispose(): Promise<void>
}

/**
 * Create the board mirror.
 * @param deps - selection source and stream opener.
 * @returns observable board state with retry and disposal.
 */
export function createBoardSource(deps: BoardSourceDeps): BoardSource {
  const listeners = new Set<() => void>()
  let snapshot: BoardSnapshot = { workspaceId: null, status: 'idle', board: null, error: null }
  let current: { workspaceId: WorkspaceId; stream: BoardStream; reading: Promise<void> } | undefined
  let unsubscribeSelection: (() => void) | undefined
  let disposed = false

  const publish = (next: BoardSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const stop = async (): Promise<void> => {
    const active = current
    current = undefined
    if (active === undefined) return
    await active.stream.dispose()
    await active.reading
  }

  const start = (): void => {
    const workspaceId = deps.selection.getSnapshot()
    if (current !== undefined && current.workspaceId === workspaceId) return
    void stop()
    if (workspaceId === null || disposed) {
      publish({ workspaceId, status: 'idle', board: null, error: null })
      return
    }
    const keep = snapshot.workspaceId === workspaceId ? snapshot.board : null
    publish({ workspaceId, status: 'loading', board: keep, error: null })
    const stream = deps.open(workspaceId)
    const isCurrent = (): boolean => current?.stream === stream
    const reading = (async () => {
      try {
        for await (const item of stream) {
          item.accept()
          if (!isCurrent()) return
          publish({ workspaceId, status: 'ready', board: item.value, error: null })
        }
      } catch (error: unknown) {
        if (!isCurrent()) return
        publish({ ...snapshot, status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    })()
    current = { workspaceId, stream, reading }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1 && !disposed) {
        unsubscribeSelection = deps.selection.subscribe(start)
        start()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        unsubscribeSelection?.()
        unsubscribeSelection = undefined
        void stop()
      }
    },
    retry() {
      if (listeners.size === 0 || disposed) return
      void stop()
      start()
    },
    async dispose() {
      disposed = true
      unsubscribeSelection?.()
      unsubscribeSelection = undefined
      await stop()
    },
  }
}

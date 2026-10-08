/** Persisted Kanban viewing state: the selected Workspace and explicit lane folding. */
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Browser-local view choices; never sent to the Host. */
export interface KanbanView {
  readonly workspaceId: WorkspaceId | null
  /** Lanes the user folded or unfolded; absent lanes use the default rule. */
  readonly collapsed: Readonly<Record<SessionId, boolean>>
}

/** View store plus the selection projection the board mirror follows. */
export interface KanbanViewState {
  readonly store: SnapshotStore<KanbanView>
  readonly selection: ObservableSnapshot<WorkspaceId | null>
}

/**
 * Create the view state persisted in this browser's local storage.
 * @param persistName - storage key; tests pass none to stay in memory.
 * @returns the store and its selection projection.
 */
export function createKanbanViewState(persistName?: string): KanbanViewState {
  const store = createSnapshotStore<KanbanView>({ workspaceId: null, collapsed: {} },
    persistName === undefined ? undefined : { persist: { name: persistName } })
  return {
    store,
    selection: {
      getSnapshot: () => store.getSnapshot().workspaceId,
      subscribe: listener => store.subscribe(listener),
    },
  }
}

/** View state keeps the selected Workspace and lane folding, optionally persisted. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { expect, it, vi } from 'vitest'
import { createKanbanViewState } from '../src/client/view-state.ts'

it('projects the selected Workspace and notifies its subscribers', () => {
  const view = createKanbanViewState()
  const listener = vi.fn()
  const off = view.selection.subscribe(listener)
  expect(view.selection.getSnapshot()).toBeNull()
  view.store.set({ workspaceId: brandString<WorkspaceId>('ws-1'), collapsed: {} })
  expect(view.selection.getSnapshot()).toBe('ws-1')
  expect(listener).toHaveBeenCalled()
  off()
  expect(createKanbanViewState('dsh.kanban.test').store.getSnapshot()).toEqual({ workspaceId: null, collapsed: {} })
})

/** Browser entry for the optional Kanban Remote contribution and board page. */
import type { Context } from '@deepseek-ai/cordis'
import kanbanRemote from '@deepseek-ai/dsh-experimental-kanban/remote'
import { mountKanban } from './mount.ts'

export { inject } from './mount.ts'
export type { KanbanInjected, KanbanPageProps, KanbanActionResult } from './KanbanPage.tsx'
export type { KanbanKey } from './locales.ts'

/**
 * Activate the experimental Kanban contribution.
 * @param ctx - Client runtime.
 * @returns complete UI and Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountKanban(ctx, kanbanRemote)
}

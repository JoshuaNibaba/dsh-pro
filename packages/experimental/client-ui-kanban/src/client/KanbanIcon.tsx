/** Decorative occupant for the Kanban sidebar entry. */
import { IconChecklistOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the checklist glyph at the size the sidebar asks for; the sidebar owns the accessible label.
 * @param props - the sidebar's icon share.
 * @returns decorative checklist icon.
 */
export function KanbanIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconChecklistOutlineRegular size={size} />
}

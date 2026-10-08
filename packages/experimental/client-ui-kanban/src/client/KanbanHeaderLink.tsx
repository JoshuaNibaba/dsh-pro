/** Conversation-header link that opens the Kanban board of the current Session's Workspace. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Navigation callback the link receives from its registration. */
export interface KanbanHeaderLinkInjected {
  /** Select the Workspace that holds the Session, then show the board page. */
  readonly openBoard: (sessionId: SessionId) => void
}

/** Header link props: the owner's tab class, the Session seat, the callback, and copy. */
export type KanbanHeaderLinkProps = PropsRuntime<'conversation.session.header.links'>
  & InjectFace<KanbanHeaderLinkInjected>
  & PropsLocale<'kanban'>

/**
 * Render the link with the View tab appearance the header supplies.
 * @param props - owner class, current Session, navigation callback, and copy.
 * @returns the link button.
 */
export function KanbanHeaderLink({ className, sessionId, openBoard, t }: KanbanHeaderLinkProps) {
  return (
    <button type="button" className={className} data-kanban-header-link="" onClick={() => { openBoard(sessionId) }}>
      {t('header.link')}
    </button>
  )
}

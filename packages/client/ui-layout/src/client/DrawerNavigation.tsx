/** Closes the phone sidebar drawer once the reader moves to another Session or panel. */
import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Props for the drawer's navigation watch. */
export type DrawerNavigationProps = Pick<PropsRuntime<'root'>, 'useSessions' | 'usePanelInfo'> & {
  /** Collapse the drawer. */
  onNavigate: () => void
}

/**
 * Watch the main view's Session and panel without subscribing the frame, and
 * call `onNavigate` when either changes after mount; what was selected when the
 * drawer opened does not count.
 * @param props - Session and panel projections and the collapse callback.
 * @returns No rendered content.
 */
export function DrawerNavigation({ useSessions, usePanelInfo, onNavigate }: DrawerNavigationProps): null {
  const panel = usePanelInfo(info => info.activePanelId)
  const session = useSessions(state => Object.values(state.byId)
    .find(summary => (summary.retainedBy.mainView ?? 0) > 0)?.id)
  const opened = useRef({ panel, session })
  useEffect(() => {
    if (opened.current.panel !== panel || opened.current.session !== session) onNavigate()
  }, [panel, session, onNavigate])
  return null
}

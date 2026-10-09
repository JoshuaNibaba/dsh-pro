/** Product-wide, versioned welcome notice: paged DeepSeek Harness Pro highlights. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WelcomeNoticeState, WelcomeNoticeStore } from './welcome-store.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import { PRO_HIGHLIGHTS } from './ProHighlights.tsx'
import stage from './ProHighlights.module.css'
import css from './WelcomeNotice.module.css'

/** Registration-side dependencies of {@link WelcomeNotice}. */
export interface WelcomeNoticeInjected {
  hooks: {
    /** Durable or process-local acknowledgement state. */
    welcome: SnapshotStore<WelcomeNoticeState>
  }
  /** Welcome acknowledgement controller. */
  controller: WelcomeNoticeStore
  /** Onboarding copy. */
  t: (key: keyof typeof en) => string
}

/** Coordinator owner props plus this step's injected face. */
export type WelcomeNoticeProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<WelcomeNoticeInjected>

/**
 * Render the highlight pages until the current notice version is acknowledged.
 * Skip and the last page's primary action both acknowledge; Back and Next only page.
 * @param props - settings-shell owner state and welcome dependencies.
 * @returns the welcome modal or null while the step decides not to show.
 */
export function WelcomeNotice(props: WelcomeNoticeProps): ReactNode {
  const { complete, controller, useWelcome, t } = props
  const state = useWelcome(snapshot => snapshot)
  const [page, setPage] = useState(0)
  const finished = useRef(false)
  const finish = useCallback((): void => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (state.acknowledged) finish()
  }, [finish, state.acknowledged])

  if (state.status === 'idle' || state.status === 'loading' || state.acknowledged) return null

  const acknowledge = (): void => {
    void controller.acknowledge().then((saved) => { if (saved) finish() })
  }
  const saving = state.status === 'saving'
  const total = PRO_HIGHLIGHTS.length
  const last = page === total - 1
  const highlight = PRO_HIGHLIGHTS[page]
  /* v8 ignore next -- Back and Next keep page inside PRO_HIGHLIGHTS */
  if (highlight === undefined) return null
  const { Illustration } = highlight
  const position = t('welcomePage').replace('{current}', String(page + 1)).replace('{total}', String(total))

  return (
    <OnboardingModal title={t('welcomeTitle')} focusTitle>
      <div className={stage.stage} aria-hidden="true" data-highlight={highlight.id}>
        <Illustration t={t} />
      </div>
      <section className={css.copy} aria-live="polite">
        <h3 className={css.heading}>{t(highlight.headingKey)}</h3>
        <p>{t(highlight.bodyKey)}</p>
      </section>
      {state.error === null ? null : <p className={css.error} role="alert">{t('welcomeError')}</p>}
      <div className={css.actions}>
        <div className={css.dots} role="img" aria-label={position}>
          {PRO_HIGHLIGHTS.map((item, index) => (
            <span key={item.id} className={index === page ? css.dotActive : css.dot} />
          ))}
        </div>
        {last ? null : <Button disabled={saving} onClick={acknowledge}>{t('welcomeSkip')}</Button>}
        {page === 0 ? null : (
          <Button variant="outline" disabled={saving} onClick={() => { setPage(page - 1) }}>
            {t('welcomeBack')}
          </Button>
        )}
        {last ? (
          <Button variant="primary" className={css.primary} disabled={saving} onClick={acknowledge}>
            {t('welcomeContinue')}
          </Button>
        ) : (
          <Button variant="primary" className={css.primary} disabled={saving} onClick={() => { setPage(page + 1) }}>
            {t('welcomeNext')}
          </Button>
        )}
      </div>
    </OnboardingModal>
  )
}

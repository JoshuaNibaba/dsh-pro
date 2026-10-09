/** General Settings row: one card per theme with a light/dark swatch. */

import type { ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_THEME } from './choice.ts'
import { THEMES, type Palette } from './palettes.ts'
import css from './ThemePackRow.module.css'

/** Registration-side theme choice. */
export interface ThemePackRowInjected {
  hooks: {
    /** The active choice, bound as useThemeChoice. */
    themeChoice: ObservableSnapshot<string>
  }
  /** Apply and store a theme id. */
  choose: (id: string) => void
}

/** Full Settings-row props. */
export type ThemePackRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.themePack'>
  & InjectFace<ThemePackRowInjected>

const SWATCH_KEYS = ['accent', 'red', 'yellow', 'green', 'blue'] as const

function Half({ palette }: { palette: Palette }): ReactNode {
  return (
    <span className={css.half} style={{ background: palette.bg0 }}>
      {SWATCH_KEYS.map(key => <span key={key} className={css.dot} style={{ background: palette[key] }} />)}
    </span>
  )
}

/**
 * Render the theme cards; the pressed card is the active choice.
 * @param props - composed Settings slot props.
 * @returns the row element tree.
 */
export function ThemePackRow({ useThemeChoice, choose, t }: ThemePackRowProps): ReactNode {
  const current = useThemeChoice(value => value)
  const card = (id: string, name: string, swatch: ReactNode): ReactNode => (
    <button key={id} type="button" className={css.card} aria-pressed={current === id} onClick={() => { choose(id) }}>
      <span className={css.swatch} aria-hidden="true">{swatch}</span>
      {name}
    </button>
  )
  return (
    <div className={css.row}>
      <div className={css.title}>{t('title')}</div>
      <div className={css.description}>{t('description')}</div>
      <div className={css.grid}>
        {card(DEFAULT_THEME, t('default'), <span className={css.plain}>{t('defaultSample')}</span>)}
        {THEMES.map(theme => card(theme.id, theme.name, (
          <>
            <Half palette={theme.light} />
            <Half palette={theme.dark} />
          </>
        )))}
      </div>
    </div>
  )
}

/**
 * Theme pack, browser half: recolors the DSH alias tokens with a well-known
 * editor scheme (Everforest by default) through the theme runtime's override
 * layer, and adds a General Settings row to switch schemes or return to the
 * built-in palette. The choice is browser-local; the Appearance row still picks
 * light, dark, or system, and this layer recolors whichever mode is active.
 */

// Type-only: the theme runtime's Context merge (ctx.theme).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_THEME, loadChoice, saveChoice } from './choice.ts'
import { en, zh, type ThemePackKey } from './locales.ts'
import { THEMES, tokensOf } from './palettes.ts'
import { ThemePackRow, type ThemePackRowInjected } from './ThemePackRow.tsx'

export type { ThemePackRowInjected, ThemePackRowProps } from './ThemePackRow.tsx'
export type { ThemePackKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Theme pack Settings row copy. */
    'settings.themePack': ThemePackKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.themePack'

/** Override-layer identity in the theme runtime. */
const SOURCE = '@deepseek-ai/dsh-client-ui-theme-pack'

/** Required services (cordis fiber inject). */
export const inject = ['theme', 'slots', 'locale']

/**
 * Apply the stored (or initial) scheme and register the Settings row.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const choice = createSnapshotStore(loadChoice())
  let remove: (() => void) | null = null
  const applyTheme = (id: string): void => {
    remove?.()
    remove = null
    const theme = THEMES.find(candidate => candidate.id === id)
    if (theme !== undefined) remove = ctx.theme.overrideTokens(SOURCE, tokensOf(theme))
  }
  ctx.effect(() => {
    applyTheme(choice.getSnapshot())
    return () => { applyTheme(DEFAULT_THEME) }
  }, 'ui-theme-pack: token layer')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-theme-pack: dictionaries')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'theme-pack',
    order: 10.5,
    locale: NS,
    inject: (): ThemePackRowInjected => ({
      hooks: { themeChoice: choice },
      choose: (id) => {
        saveChoice(id)
        choice.set(id)
        applyTheme(id)
      },
    }),
  }, ThemePackRow))
}

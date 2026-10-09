/** The browser-local theme choice: one id in localStorage, read once per page load. */

import { THEMES } from './palettes.ts'

/** localStorage key holding the chosen theme id. */
export const STORAGE_KEY = 'dsh-theme-pack'

/** The id that keeps the built-in DSH palette (no override layer). */
export const DEFAULT_THEME = 'default'

/** The theme a browser without a stored choice uses. */
export const INITIAL_THEME = 'everforest'

/**
 * Whether an id names a selectable choice.
 * @param id - candidate theme id.
 * @returns true for {@link DEFAULT_THEME} and every pack theme.
 */
export function isKnownTheme(id: string): boolean {
  return id === DEFAULT_THEME || THEMES.some(theme => theme.id === id)
}

/**
 * Read the stored choice.
 * @returns the stored known id, or {@link INITIAL_THEME} when none is stored, it is unknown, or storage is unavailable.
 */
export function loadChoice(): string {
  try {
    const id = window.localStorage.getItem(STORAGE_KEY)
    return id !== null && isKnownTheme(id) ? id : INITIAL_THEME
  } catch (_storageUnavailable) {
    // Private modes and sandboxed frames refuse storage; the initial theme still applies.
    return INITIAL_THEME
  }
}

/**
 * Store a choice for later page loads.
 * @param id - known theme id.
 */
export function saveChoice(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch (_storageUnavailable) {
    // Without storage the choice lasts for this page only.
  }
}

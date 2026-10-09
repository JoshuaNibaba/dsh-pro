// @vitest-environment jsdom
/** The stored theme choice and its fallbacks. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { INITIAL_THEME, isKnownTheme, loadChoice, saveChoice, STORAGE_KEY } from '../src/client/choice.ts'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('theme choice', () => {
  it('starts on Everforest and remembers a known choice', () => {
    expect(loadChoice()).toBe(INITIAL_THEME)
    expect(INITIAL_THEME).toBe('everforest')
    saveChoice('nord')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('nord')
    expect(loadChoice()).toBe('nord')
    saveChoice('default')
    expect(loadChoice()).toBe('default')
  })

  it('ignores an unknown stored id', () => {
    window.localStorage.setItem(STORAGE_KEY, 'retired-theme')
    expect(isKnownTheme('retired-theme')).toBe(false)
    expect(loadChoice()).toBe(INITIAL_THEME)
  })

  it('keeps working when storage refuses access', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(loadChoice()).toBe(INITIAL_THEME)
    expect(() => { saveChoice('nord') }).not.toThrow()
  })
})

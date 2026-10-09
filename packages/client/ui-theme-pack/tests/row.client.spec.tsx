// @vitest-environment jsdom
/** The General Settings row: one pressed card for the active scheme. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemePackRow, type ThemePackRowProps } from '../src/client/ThemePackRow.tsx'
import { zh } from '../src/client/locales.ts'
// Type-only: the settings.themePack LocaleNamespaceMap merge.
import type { ThemePackKey } from '../src/client/index.ts'

afterEach(cleanup)

function mount(current: string) {
  const choose = vi.fn()
  const face: Partial<ThemePackRowProps> = {
    useThemeChoice: selector => selector(current),
    choose,
    t: key => zh[key as ThemePackKey],
  }
  const props = face as ThemePackRowProps
  render(<ThemePackRow {...props} />)
  return choose
}

describe('ThemePackRow', () => {
  it('lists the built-in palette and every scheme, pressing the active one', () => {
    mount('everforest')
    expect(screen.getByText(zh.title)).toBeTruthy()
    expect(screen.getByText(zh.description)).toBeTruthy()
    const cards = screen.getAllByRole('button')
    expect(cards.map(card => card.textContent)).toEqual([
      `${zh.defaultSample}${zh.default}`, 'Everforest', 'Gruvbox', 'Catppuccin', 'Rosé Pine', 'Tokyo Night', 'Nord', 'Solarized', 'Kanagawa', 'GitHub',
    ])
    expect(cards.filter(card => card.getAttribute('aria-pressed') === 'true').map(card => card.textContent)).toEqual(['Everforest'])
  })

  it('chooses the clicked scheme or the built-in palette', () => {
    const choose = mount('everforest')
    fireEvent.click(screen.getByRole('button', { name: 'Nord' }))
    fireEvent.click(screen.getAllByRole('button')[0]!)
    expect(choose.mock.calls).toEqual([['nord'], ['default']])
  })
})

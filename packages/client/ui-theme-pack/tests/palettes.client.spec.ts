/** Scheme data and the token layer each scheme produces. */

import { describe, expect, it } from 'vitest'
import { mix, THEMES, tokensOf } from '../src/client/palettes.ts'

describe('theme pack palettes', () => {
  it('ships nine schemes with unique ids, Everforest first', () => {
    expect(THEMES.map(theme => theme.id)).toEqual([
      'everforest', 'gruvbox', 'catppuccin', 'rose-pine', 'tokyo-night', 'nord', 'solarized', 'kanagawa', 'github',
    ])
  })

  it('maps every scheme onto the same alias and specific tokens, with both modes as colors', () => {
    const names = Object.keys(tokensOf(THEMES[0]!)).sort()
    expect(names).toContain('--dsw-alias-bg-base')
    expect(names).toContain('--dsw-alias-state-business-primary')
    expect(names).toContain('--shiki-foreground')
    for (const theme of THEMES) {
      const tokens = tokensOf(theme)
      expect(Object.keys(tokens).sort()).toEqual(names)
      for (const value of Object.values(tokens)) {
        expect(value.light).toMatch(/^(#|rgba\(|color-mix\()/)
        expect(value.dark).toMatch(/^(#|rgba\(|color-mix\()/)
      }
    }
  })

  it('keeps declared state tints and derives missing ones from the base and accent', () => {
    const everforest = tokensOf(THEMES[0]!)
    expect(everforest['--dsw-alias-state-success-tertiary']).toEqual({ light: '#F0F1D2', dark: '#425047' })
    const nord = THEMES.find(theme => theme.id === 'nord')!
    expect(tokensOf(nord)['--dsw-alias-state-success-tertiary']).toEqual({
      light: mix(nord.light.bg0, nord.light.green, 0.14),
      dark: mix(nord.dark.bg0, nord.dark.green, 0.2),
    })
    expect(everforest['--dsw-alias-border-l1']).toEqual({ light: 'rgba(92, 106, 114, 0.08)', dark: 'rgba(211, 198, 170, 0.08)' })
  })

  it('blends colors channel by channel', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030')
  })
})

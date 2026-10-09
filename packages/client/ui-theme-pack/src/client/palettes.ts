/**
 * Editor color schemes mapped onto the DSH alias tokens. Each theme carries a
 * light and a dark palette; the Appearance preference still picks the mode,
 * and the chosen theme recolors both.
 */

import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** One palette: neutral backgrounds `bgDim`, `bg0` (base) to `bg5`, ink, greys, and accents. */
export interface Palette {
  bgDim: string
  bg0: string
  bg1: string
  bg2: string
  bg3: string
  bg4: string
  bg5: string
  /** Tinted state backgrounds; derived from `bg0` and the accent when absent. */
  bgRed?: string
  bgGreen?: string
  bgBlue?: string
  bgYellow?: string
  fg: string
  red: string
  orange: string
  yellow: string
  green: string
  aqua: string
  blue: string
  purple: string
  /** Caption ink, the faintest grey. */
  grey0: string
  /** Tertiary ink. */
  grey1: string
  /** Secondary ink. */
  grey2: string
  /** Brand accent. */
  accent: string
}

/** A selectable color scheme. */
export interface ThemePack {
  /** Stable id stored as the browser's choice. */
  id: string
  /** Display name; scheme names are proper nouns and stay untranslated. */
  name: string
  light: Palette
  dark: Palette
}

/** A palette with every derived key filled. */
type Complete = Required<Palette> & { ink: string }
type Pick = (palette: Complete, dark: boolean) => string

const channel = (hex: string, index: number): number => parseInt(hex.slice(index, index + 2), 16)
const rgbOf = (hex: string): [number, number, number] => [channel(hex, 1), channel(hex, 3), channel(hex, 5)]
const hexOf = (rgb: number[]): string => '#' + rgb.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')

/**
 * Blend `b` into `a`.
 * @param a - base `#rrggbb` color.
 * @param b - color blended in.
 * @param weight - fraction of `b`, 0 to 1.
 * @returns the blended `#rrggbb` color.
 */
export function mix(a: string, b: string, weight: number): string {
  const [r1, g1, b1] = rgbOf(a)
  const [r2, g2, b2] = rgbOf(b)
  return hexOf([r1 + (r2 - r1) * weight, g1 + (g2 - g1) * weight, b1 + (b2 - b1) * weight])
}

const rgba = (hex: string, alpha: number): string => `rgba(${rgbOf(hex).join(', ')}, ${String(alpha)})`

/** The selectable schemes in display order; the first is the initial choice. */
export const THEMES: readonly ThemePack[] = [
  {
    id: 'everforest', name: 'Everforest',
    light: { bgDim: '#EFEBD4', bg0: '#FDF6E3', bg1: '#F4F0D9', bg2: '#EFEBD4', bg3: '#E6E2CC', bg4: '#E0DCC7', bg5: '#BDC3AF',
      bgRed: '#FDE3DA', bgGreen: '#F0F1D2', bgBlue: '#E9F0E9', bgYellow: '#FAEDCD',
      fg: '#5C6A72', red: '#F85552', orange: '#F57D26', yellow: '#DFA000', green: '#8DA101', aqua: '#35A77C', blue: '#3A94C5', purple: '#DF69BA',
      grey0: '#A6B0A0', grey1: '#939F91', grey2: '#829181', accent: '#8DA101' },
    dark: { bgDim: '#232A2E', bg0: '#2D353B', bg1: '#343F44', bg2: '#3D484D', bg3: '#475258', bg4: '#4F585E', bg5: '#56635F',
      bgRed: '#514045', bgGreen: '#425047', bgBlue: '#3A515D', bgYellow: '#4D4C43',
      fg: '#D3C6AA', red: '#E67E80', orange: '#E69875', yellow: '#DBBC7F', green: '#A7C080', aqua: '#83C092', blue: '#7FBBB3', purple: '#D699B6',
      grey0: '#7A8478', grey1: '#859289', grey2: '#9DA9A0', accent: '#A7C080' },
  },
  {
    id: 'gruvbox', name: 'Gruvbox',
    light: { bgDim: '#F2E5BC', bg0: '#FBF1C7', bg1: '#F2E5BC', bg2: '#EBDBB2', bg3: '#D5C4A1', bg4: '#BDAE93', bg5: '#A89984',
      fg: '#3C3836', red: '#9D0006', orange: '#AF3A03', yellow: '#B57614', green: '#79740E', aqua: '#427B58', blue: '#076678', purple: '#8F3F71',
      grey0: '#928374', grey1: '#7C6F64', grey2: '#665C54', accent: '#AF3A03' },
    dark: { bgDim: '#1D2021', bg0: '#282828', bg1: '#32302F', bg2: '#3C3836', bg3: '#504945', bg4: '#665C54', bg5: '#7C6F64',
      fg: '#EBDBB2', red: '#FB4934', orange: '#FE8019', yellow: '#FABD2F', green: '#B8BB26', aqua: '#8EC07C', blue: '#83A598', purple: '#D3869B',
      grey0: '#928374', grey1: '#A89984', grey2: '#BDAE93', accent: '#FE8019' },
  },
  {
    id: 'catppuccin', name: 'Catppuccin',
    light: { bgDim: '#E6E9EF', bg0: '#EFF1F5', bg1: '#E6E9EF', bg2: '#DCE0E8', bg3: '#CCD0DA', bg4: '#BCC0CC', bg5: '#ACB0BE',
      fg: '#4C4F69', red: '#D20F39', orange: '#FE640B', yellow: '#DF8E1D', green: '#40A02B', aqua: '#179299', blue: '#1E66F5', purple: '#8839EF',
      grey0: '#9CA0B0', grey1: '#7C7F93', grey2: '#6C6F85', accent: '#8839EF' },
    dark: { bgDim: '#181825', bg0: '#1E1E2E', bg1: '#282839', bg2: '#313244', bg3: '#45475A', bg4: '#585B70', bg5: '#6C7086',
      fg: '#CDD6F4', red: '#F38BA8', orange: '#FAB387', yellow: '#F9E2AF', green: '#A6E3A1', aqua: '#94E2D5', blue: '#89B4FA', purple: '#CBA6F7',
      grey0: '#7F849C', grey1: '#9399B2', grey2: '#A6ADC8', accent: '#CBA6F7' },
  },
  {
    id: 'rose-pine', name: 'Rosé Pine',
    light: { bgDim: '#F2E9E1', bg0: '#FAF4ED', bg1: '#F4EDE8', bg2: '#F2E9E1', bg3: '#DFDAD9', bg4: '#CECACD', bg5: '#B9B5C1',
      fg: '#575279', red: '#B4637A', orange: '#D7827E', yellow: '#EA9D34', green: '#286983', aqua: '#56949F', blue: '#286983', purple: '#907AA9',
      grey0: '#9893A5', grey1: '#797593', grey2: '#6A6588', accent: '#286983' },
    dark: { bgDim: '#13111B', bg0: '#191724', bg1: '#1F1D2E', bg2: '#26233A', bg3: '#403D52', bg4: '#524F67', bg5: '#6E6A86',
      fg: '#E0DEF4', red: '#EB6F92', orange: '#EBBCBA', yellow: '#F6C177', green: '#31748F', aqua: '#9CCFD8', blue: '#9CCFD8', purple: '#C4A7E7',
      grey0: '#6E6A86', grey1: '#908CAA', grey2: '#B0ADC6', accent: '#EBBCBA' },
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night',
    light: { bgDim: '#D0D5E3', bg0: '#E1E2E7', bg1: '#D8DBE5', bg2: '#D0D5E3', bg3: '#C4C8DA', bg4: '#B6BCD6', bg5: '#A1A6C5',
      fg: '#3760BF', red: '#F52A65', orange: '#B15C00', yellow: '#8C6C3E', green: '#587539', aqua: '#007197', blue: '#2E7DE9', purple: '#9854F1',
      grey0: '#8990B3', grey1: '#6172B0', grey2: '#4C69B8', accent: '#2E7DE9' },
    dark: { bgDim: '#16161E', bg0: '#1A1B26', bg1: '#1F2335', bg2: '#292E42', bg3: '#3B4261', bg4: '#414868', bg5: '#545C7E',
      fg: '#C0CAF5', red: '#F7768E', orange: '#FF9E64', yellow: '#E0AF68', green: '#9ECE6A', aqua: '#7DCFFF', blue: '#7AA2F7', purple: '#BB9AF7',
      grey0: '#565F89', grey1: '#737AA2', grey2: '#A9B1D6', accent: '#7AA2F7' },
  },
  {
    id: 'nord', name: 'Nord',
    light: { bgDim: '#E5E9F0', bg0: '#ECEFF4', bg1: '#E5E9F0', bg2: '#D8DEE9', bg3: '#CBD2DE', bg4: '#B9C1CF', bg5: '#9DA6B8',
      fg: '#2E3440', red: '#BF616A', orange: '#B86A50', yellow: '#A9925E', green: '#76895F', aqua: '#5F8C8B', blue: '#5E81AC', purple: '#9A6E94',
      grey0: '#8A93A5', grey1: '#6A7488', grey2: '#4C566A', accent: '#5E81AC' },
    dark: { bgDim: '#242933', bg0: '#2E3440', bg1: '#3B4252', bg2: '#434C5E', bg3: '#4C566A', bg4: '#5A6479', bg5: '#6A7488',
      fg: '#ECEFF4', red: '#BF616A', orange: '#D08770', yellow: '#EBCB8B', green: '#A3BE8C', aqua: '#8FBCBB', blue: '#81A1C1', purple: '#B48EAD',
      grey0: '#616E88', grey1: '#8A93A5', grey2: '#D8DEE9', accent: '#88C0D0' },
  },
  {
    id: 'solarized', name: 'Solarized',
    light: { bgDim: '#EEE8D5', bg0: '#FDF6E3', bg1: '#EEE8D5', bg2: '#E6E1D0', bg3: '#DCD9CA', bg4: '#C9C8BC', bg5: '#93A1A1',
      fg: '#586E75', red: '#DC322F', orange: '#CB4B16', yellow: '#B58900', green: '#859900', aqua: '#2AA198', blue: '#268BD2', purple: '#6C71C4',
      grey0: '#93A1A1', grey1: '#7C8E92', grey2: '#657B83', accent: '#268BD2' },
    dark: { bgDim: '#002028', bg0: '#002B36', bg1: '#073642', bg2: '#1A4450', bg3: '#2C505A', bg4: '#3F5C64', bg5: '#586E75',
      fg: '#93A1A1', red: '#DC322F', orange: '#CB4B16', yellow: '#B58900', green: '#859900', aqua: '#2AA198', blue: '#268BD2', purple: '#6C71C4',
      grey0: '#586E75', grey1: '#6E8186', grey2: '#839496', accent: '#268BD2' },
  },
  {
    id: 'kanagawa', name: 'Kanagawa',
    light: { bgDim: '#E5DDB0', bg0: '#F2ECBC', bg1: '#E5DDB0', bg2: '#DCD5AC', bg3: '#D5CEA3', bg4: '#C7BF95', bg5: '#A8A389',
      fg: '#545464', red: '#C84053', orange: '#CC6D00', yellow: '#77713F', green: '#6F894E', aqua: '#597B75', blue: '#4D699B', purple: '#624C83',
      grey0: '#8A8980', grey1: '#716E61', grey2: '#5F5D57', accent: '#4D699B' },
    dark: { bgDim: '#16161D', bg0: '#1F1F28', bg1: '#2A2A37', bg2: '#363646', bg3: '#41414F', bg4: '#54546D', bg5: '#625E5A',
      fg: '#DCD7BA', red: '#E46876', orange: '#FFA066', yellow: '#E6C384', green: '#98BB6C', aqua: '#7AA89F', blue: '#7E9CD8', purple: '#957FB8',
      grey0: '#727169', grey1: '#938E7A', grey2: '#C8C093', accent: '#7E9CD8' },
  },
  {
    id: 'github', name: 'GitHub',
    light: { bgDim: '#F6F8FA', bg0: '#FFFFFF', bg1: '#F6F8FA', bg2: '#EFF2F5', bg3: '#E6EAEF', bg4: '#D0D7DE', bg5: '#AFB8C1',
      fg: '#1F2328', red: '#D1242F', orange: '#BC4C00', yellow: '#9A6700', green: '#1A7F37', aqua: '#1B7C83', blue: '#0969DA', purple: '#8250DF',
      grey0: '#8C959F', grey1: '#6E7781', grey2: '#59636E', accent: '#0969DA' },
    dark: { bgDim: '#010409', bg0: '#0D1117', bg1: '#161B22', bg2: '#21262D', bg3: '#30363D', bg4: '#3D444D', bg5: '#484F58',
      fg: '#E6EDF3', red: '#F85149', orange: '#DB6D28', yellow: '#D29922', green: '#3FB950', aqua: '#39C5CF', blue: '#58A6FF', purple: '#A371F7',
      grey0: '#6E7681', grey1: '#7D8590', grey2: '#9198A1', accent: '#58A6FF' },
  },
]

/** Fill the tinted state backgrounds and the ink triplet. */
function complete(palette: Palette, dark: boolean): Complete {
  const tint = dark ? 0.2 : 0.14
  return {
    ...palette,
    bgRed: palette.bgRed ?? mix(palette.bg0, palette.red, tint),
    bgGreen: palette.bgGreen ?? mix(palette.bg0, palette.green, tint),
    bgBlue: palette.bgBlue ?? mix(palette.bg0, palette.blue, tint),
    bgYellow: palette.bgYellow ?? mix(palette.bg0, palette.yellow, tint),
    ink: rgbOf(palette.fg).join(', '),
  }
}

const ink = (palette: Complete, alpha: number): string => `rgba(${palette.ink}, ${String(alpha)})`
const shade = (color: string, dark: boolean): string => `color-mix(in srgb, ${color} 85%, ${dark ? 'white' : 'black'})`

const ALIAS: Record<string, Pick> = {
  'bg-base': p => p.bg0,
  'bg-layer-1': (p, d) => (d ? p.bg1 : p.bg0),
  'bg-layer-2': (p, d) => (d ? p.bg2 : p.bg1),
  'bg-layer-3': (p, d) => (d ? p.bg3 : p.bg2),
  'bg-overlay': (p, d) => (d ? p.bg4 : p.bg3),
  'bg-document-preview': (p, d) => (d ? p.bgDim : p.bg1),
  'label-document-preview': p => p.grey2,
  'bg-module-platform': (p, d) => (d ? p.bg2 : p.bg1),
  'bg-multi-select': p => p.bg2,
  'bg-skeleton': (p, d) => ink(p, d ? 0.08 : 0.06),
  'bg-mask-drop': p => rgba(p.bg0, 0.7),
  'bg-document-selection': p => `color-mix(in srgb, ${p.blue} 35%, transparent)`,
  'border-l1': p => ink(p, 0.08),
  'border-l2-darkmode-thin': (p, d) => ink(p, d ? 0.08 : 0.14),
  'border-l2': (p, d) => ink(p, d ? 0.14 : 0.16),
  'border-l3': (p, d) => ink(p, d ? 0.18 : 0.2),
  'border-l4': (p, d) => ink(p, d ? 0.24 : 0.26),
  'brand-primary': p => p.accent,
  'brand-primary-invert': p => p.bg0,
  'brand-primary-new-colorprimary-new-color': p => p.accent,
  'brand-text': p => p.fg,
  'button-primary-hover': (p, d) => shade(p.accent, d),
  'button-primary-dimmed': (p, d) => (d ? p.bg3 : p.bg2),
  'button-contrast-fill': p => p.fg,
  'button-elevated-fill': (p, d) => (d ? p.bg3 : p.bg0),
  'button-floating-fill': (p, d) => (d ? p.bg2 : p.bg0),
  'button-floating-hover': (p, d) => (d ? p.bg3 : p.bg1),
  'button-ghost-active-border': p => p.grey0,
  'button-ghost-active-fill': (p, d) => (d ? p.bg3 : p.bg2),
  'button-ghost-active-hover': (p, d) => (d ? p.bg4 : p.bg3),
  'button-info-fill': p => p.blue,
  'button-info-hover': (p, d) => shade(p.blue, d),
  'interactive-bg-hover': p => ink(p, 0.08),
  'interactive-bg-active': (p, d) => ink(p, d ? 0.14 : 0.12),
  'interactive-bg-hover-accent': (p, d) => ink(p, d ? 0.22 : 0.16),
  'interactive-bg-hover-solid': (p, d) => (d ? p.bg2 : p.bg1),
  'interactive-bg-hover-danger': p => `color-mix(in srgb, ${p.red} 12%, transparent)`,
  'label-primary': p => p.fg,
  'label-primary-dimmed': p => p.fg,
  'label-primary-bluish': p => p.fg,
  'label-primary-foreground': p => p.bg0,
  'label-primary-inverted': p => p.bg0,
  'label-secondary': p => p.grey2,
  'label-tertiary': p => p.grey1,
  'label-caption': p => p.grey0,
  'label-dimmed': p => p.bg5,
  'label-deep-diving': p => p.aqua,
  'label-deep-diving-shimmer': p => `color-mix(in srgb, ${p.aqua} 40%, ${p.fg})`,
  'menu-icon': p => p.fg,
  'link': p => p.blue,
  'markdown-code-block': p => p.bg1,
  'markdown-code-block-banner': p => p.bg2,
  'markdown-inline-code': p => p.bg2,
  'markdown-citation': (p, d) => (d ? p.bg3 : p.bg2),
  'markdown-tag': (p, d) => (d ? p.bg2 : p.bg1),
  'markdown-placeholder': (p, d) => (d ? p.bg2 : p.bg1),
  'markdown-code-segment-selected': (p, d) => (d ? p.bg3 : p.bg0),
  'markdown-code-segment-unselected': p => p.bg1,
  'code-diff-added': p => `color-mix(in srgb, ${p.green} 12%, transparent)`,
  'code-diff-deleted': p => `color-mix(in srgb, ${p.red} 10%, transparent)`,
  'file-diff-added-bg': p => p.bgGreen,
  'file-diff-added-gutter': p => mix(p.bgGreen, p.bg0, 0.4),
  'file-diff-added-marker': p => p.green,
  'file-diff-deleted-bg': p => p.bgRed,
  'file-diff-deleted-gutter': p => mix(p.bgRed, p.bg0, 0.4),
  'file-diff-deleted-marker': p => p.red,
  'scrollbar-bg-l1': p => p.bg4,
  'scrollbar-bg-l2': p => p.bg5,
  'scrollbar-hover-l1': (p, d) => (d ? p.grey0 : p.bg5),
  'scrollbar-hover-l2': p => p.grey1,
  'state-business-primary': p => p.blue,
  'state-business-tertiary': p => p.bgBlue,
  'state-error-primary': p => p.red,
  'state-error-secondary': p => p.red,
  'state-idle-primary': p => p.grey0,
  'state-success-primary': p => p.green,
  'state-success-secondary': p => p.green,
  'state-success-tertiary': p => p.bgGreen,
  'state-warn-label': p => p.yellow,
  'state-warn-primary': p => p.yellow,
  'state-warn-secondary': p => p.orange,
  'state-warn-tertiary': p => p.bgYellow,
  'switch-thumb': (p, d) => (d ? p.grey2 : p.bg0),
  'toast-bg': (p, d) => (d ? p.bg4 : p.fg),
  'toast-label': (p, d) => (d ? p.fg : p.bg0),
  'tooltip-bg': (p, d) => (d ? p.bg4 : p.fg),
  'menu-group-header-fill': (p, d) => rgba(d ? p.bg2 : p.bg1, 0.94),
}

const SPECIFIC: Record<string, Pick> = {
  '--dsw-menu-surface-fill': (p, d) => rgba(d ? p.bg2 : p.bg1, d ? 0.55 : 0.6),
  '--dsw-specific-bubble': (p, d) => (d ? p.bg2 : p.bgGreen),
  '--dsw-specific-bubble-highlight': (p, d) => (d ? p.bg3 : mix(p.bg0, p.green, 0.2)),
  '--dsw-specific-input-major': (p, d) => (d ? p.bg1 : p.bg0),
  '--dsw-specific-login-input': (p, d) => (d ? p.bgDim : p.bg1),
  '--dsw-specific-selector': p => p.bg2,
  '--dsw-specific-sidebar-fill': (p, d) => (d ? p.bgDim : p.bg1),
  '--dsw-specific-sidebar-nav-item-active': (p, d) => (d ? p.bg2 : p.bg3),
  '--dsw-specific-sidebar-nav-item-active-accent': p => mix(p.bg0, p.accent, 0.18),
  '--dsw-specific-sidebar-nav-item-hover': (p, d) => (d ? p.bg1 : p.bg2),
  '--dsw-specific-tip': (p, d) => (d ? p.bg2 : p.bg1),
  '--shiki-foreground': p => p.fg,
  '--shiki-background': p => p.bg1,
  '--shiki-token-constant': p => p.purple,
  '--shiki-token-string': p => p.aqua,
  '--shiki-token-comment': p => p.grey1,
  '--shiki-token-keyword': p => p.red,
  '--shiki-token-parameter': p => p.blue,
  '--shiki-token-function': p => p.green,
  '--shiki-token-string-expression': p => p.aqua,
  '--shiki-token-punctuation': p => p.grey2,
  '--shiki-token-link': p => p.blue,
}

/**
 * Build the token override layer for one theme.
 * @param theme - the selected scheme.
 * @returns every overridden token as a `{ light, dark }` pair for `ctx.theme.overrideTokens`.
 */
export function tokensOf(theme: ThemePack): ThemeTokenOverrides {
  const light = complete(theme.light, false)
  const dark = complete(theme.dark, true)
  const tokens: ThemeTokenOverrides = {}
  const add = (name: string, pick: Pick): void => { tokens[name] = { light: pick(light, false), dark: pick(dark, true) } }
  for (const [name, pick] of Object.entries(ALIAS)) add(`--dsw-alias-${name}`, pick)
  for (const [name, pick] of Object.entries(SPECIFIC)) add(name, pick)
  return tokens
}

/** Copy dictionaries for the theme pack's Settings row. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  title: 'Color theme',
  description: 'Applies to both light and dark appearance; saved in this browser.',
  default: 'Default',
  defaultSample: 'Aa',
}

/** The settings.themePack namespace key union. */
export type ThemePackKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in ThemePackKey]: string } = {
  title: '配色主题',
  description: '在浅色和深色外观下都会生效；选择保存在当前浏览器中。',
  default: '默认',
  defaultSample: 'Aa',
}

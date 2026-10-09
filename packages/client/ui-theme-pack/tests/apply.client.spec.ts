// @vitest-environment jsdom
/** What the browser half applies and registers, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, NS } from '../src/client/index.ts'
import type { ThemePackRowInjected } from '../src/client/index.ts'
import { STORAGE_KEY } from '../src/client/choice.ts'
import { THEMES, tokensOf } from '../src/client/palettes.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => { window.localStorage.clear() })

/** The General row's injected face, as the renderer would receive it. */
function faceOf(slots: SlotRegistry): ThemePackRowInjected {
  const inject = slots.entries('settings.general.item')[0]?.inject
  if (inject === undefined) throw new Error('theme-pack row is not registered')
  const face = inject()
  if (!isFace(face)) throw new Error('theme-pack row injected an unexpected face')
  return face
}

function isFace(value: Record<string, unknown>): value is Record<string, unknown> & ThemePackRowInjected {
  return typeof value.choose === 'function' && typeof value.hooks === 'object'
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const removed: string[] = []
  const overrideTokens = vi.fn((source: string, tokens: Record<string, unknown>) => {
    const id = Object.keys(tokens).length === 0 ? 'empty' : JSON.stringify(tokens['--dsw-alias-bg-base'])
    return () => { removed.push(`${source} ${id}`) }
  })
  ctx.provide('theme', { overrideTokens })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'settings.general.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  return { ctx, slots, overrideTokens, removed, locale }
}

describe('ui-theme-pack apply', () => {
  it('keeps the host Loader entry inert and declares its services', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['theme', 'slots', 'locale'])
  })

  it('applies Everforest on a fresh browser and registers the General row', async () => {
    const { ctx, slots, overrideTokens, locale } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(overrideTokens).toHaveBeenCalledWith('@deepseek-ai/dsh-client-ui-theme-pack', tokensOf(THEMES[0]!))
    const entry = slots.entries('settings.general.item')[0]!
    expect(entry.options).toMatchObject({ id: 'theme-pack', order: 10.5 })
    expect(entry.locale).toBe(NS)
    expect(locale.bind(NS)('title')).toBe('配色主题')
  })

  it('switches schemes, returns to the built-in palette, and remembers the choice', async () => {
    const { ctx, slots, overrideTokens, removed } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(slots)
    const nord = THEMES.find(theme => theme.id === 'nord')!
    face.choose('nord')
    expect(overrideTokens).toHaveBeenLastCalledWith('@deepseek-ai/dsh-client-ui-theme-pack', tokensOf(nord))
    expect(face.hooks.themeChoice.getSnapshot()).toBe('nord')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('nord')
    face.choose('default')
    expect(overrideTokens).toHaveBeenCalledTimes(2)
    expect(removed).toHaveLength(2)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('default')
  })

  it('starts from the stored built-in choice without a layer, and leaves with its fiber', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'default')
    const { ctx, slots, overrideTokens, removed } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(overrideTokens).not.toHaveBeenCalled()
    const face = faceOf(slots)
    face.choose('gruvbox')
    await fiber.dispose()
    expect(removed).toHaveLength(1)
    expect(slots.entries('settings.general.item')).toHaveLength(0)
  })
})

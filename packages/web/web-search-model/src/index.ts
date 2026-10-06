/**
 * Register the `model-native` search provider in `ctx.web`. Each search uses
 * the server-side search tool of the provider route that serves the
 * initiating Session, so the conversation's own model performs the search;
 * routes whose native search another provider owns delegate to it by id.
 * @module @deepseek-ai/dsh-web-search-model
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-web'
import { MODEL_NATIVE_PROVIDER_ID, ModelNativeSearchProvider } from './provider.ts'

export { MODEL_NATIVE_PROVIDER_ID, ModelNativeSearchProvider, toWebSearchResult } from './provider.ts'
export type { ModelSearchRouting } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-model'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config. */
export interface Config {
  /** Search model id per provider route; a route absent here searches with the conversation's model. */
  models: Record<string, string>
  /**
   * Search provider id per provider route, for routes whose native search
   * another registered provider serves (DeepSeek routes use `deepseek-official`).
   */
  delegates: Record<string, string>
}

export const Config: z<Config> = z.object({
  models: z.dict(z.string()).default({}),
  delegates: z.dict(z.string()).default({}),
})

/**
 * Register the provider. A delegate naming this provider fails at load,
 * because the search would re-enter itself.
 * @param ctx - plugin context supplying `web`, `llm`, and `agents`.
 * @param config - route-keyed search model and delegate choices.
 */
export function apply(ctx: Context, config: Config): void {
  for (const [route, delegate] of Object.entries(config.delegates)) {
    if (delegate === MODEL_NATIVE_PROVIDER_ID) {
      throw new Error(`web-search-model.delegates.${route} cannot name "${MODEL_NATIVE_PROVIDER_ID}" itself`)
    }
  }
  const routing = { models: { ...config.models }, delegates: { ...config.delegates } }
  ctx.web.registerSearchProvider(new ModelNativeSearchProvider(ctx, () => routing))
}

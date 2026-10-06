/** Validated timing options forwarded in the browser bootstrap injection table. */
import z from '@deepseek-ai/schemastery'

/** Sampling and request timings, in milliseconds. */
export interface Config {
  /** Shared Host sampling cadence and browser polling delay. */
  sampleIntervalMs: number
  /** Maximum time allowed for one browser RPC request. */
  requestTimeoutMs: number
}

/** Positive bounded integer timings; invalid deployment values fail plugin load. */
export const Config: z<Config> = z.object({
  sampleIntervalMs: z.natural().min(250).max(3_600_000).default(3_000),
  requestTimeoutMs: z.natural().min(100).max(300_000).default(5_000),
})

/** Resolve untrusted boot timing values using the same Host configuration schema.
 * @param value Browser bootstrap settings or explicit Loader configuration.
 * @returns Validated timings with declared defaults applied.
 */
export function resolveConfig(value: unknown): Config {
  return z.resolve(value, Config, {})[0] as Config
}

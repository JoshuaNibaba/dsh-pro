/** Host-owned CPU delta and Linux available-memory sampler. */
import { cpus, platform } from 'node:os'
import { readFileSync } from 'node:fs'
import type { ServerSnapshot } from './types.ts'

interface CpuTimes { user: number; nice: number; sys: number; idle: number; irq: number }
interface SampleInputs {
  cpus(): readonly { times: CpuTimes }[]
  platform(): string
  meminfo(): string
}
const systemInputs: SampleInputs = {
  cpus,
  platform,
  meminfo: () => readFileSync('/proc/meminfo', 'utf8'),
}

/** Decode Linux MemTotal and MemAvailable; cached/reclaimable memory remains available.
 * @param text Contents of the tiny proc memory statistics file.
 * @returns Used and total bytes, or null when fields are missing or invalid.
 */
export function parseMeminfo(text: string): ServerSnapshot['memory'] {
  const total = /^MemTotal:\s+(\d+)\s+kB\s*$/m.exec(text)
  const available = /^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(text)
  if (total === null || available === null) return null
  const totalBytes = Number(total[1]) * 1024
  const availableBytes = Number(available[1]) * 1024
  if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(availableBytes)
    || totalBytes <= 0 || availableBytes > totalBytes) return null
  return { totalBytes, usedBytes: totalBytes - availableBytes }
}

/** One shared sampler per Host plugin lifetime; CPU failures reset the delta baseline. */
export class ServerSampler {
  private previous: readonly CpuTimes[] | null = null
  private current: ServerSnapshot = { cpuPercent: null, memory: null }

  constructor(private readonly inputs: SampleInputs = systemInputs) {}

  /** Read the latest sample without touching the operating system.
   * @returns Shared server-wide readings.
   */
  snapshot(): ServerSnapshot { return this.current }

  /** Refresh both readings independently; failed reads disclose no error details.
   * @returns The new snapshot. The first CPU reading is unavailable.
   */
  sample(): ServerSnapshot {
    let cpuPercent: number | null = null
    let memory: ServerSnapshot['memory'] = null
    let times: readonly CpuTimes[] = []
    try {
      times = this.inputs.cpus().map(cpu => ({ ...cpu.times }))
    } catch (error) {
      // OS access failure invalidates the next delta.
      void error
      this.previous = null
    }
    if (times.length > 0 && times.length === this.previous?.length) {
      let idle = 0
      let total = 0
      let valid = true
      for (const [index, now] of times.entries()) {
        const before = this.previous[index] as CpuTimes
        for (const key of ['user', 'nice', 'sys', 'idle', 'irq'] as const) {
          const delta = now[key] - before[key]
          if (!Number.isFinite(delta) || delta < 0) valid = false
          total += delta
          if (key === 'idle') idle += delta
        }
      }
      if (valid && total > 0) cpuPercent = Math.max(0, Math.min(100, (1 - idle / total) * 100))
    }
    this.previous = times.length === 0 ? null : times
    if (this.inputs.platform() === 'linux') {
      try {
        memory = parseMeminfo(this.inputs.meminfo())
      } catch (error) {
        // A missing or inaccessible proc file is an unavailable reading.
        void error
      }
    }
    this.current = { cpuPercent, memory }
    return this.current
  }
}

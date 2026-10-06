/** JSON decoder for snapshot RPC responses consumed by the browser poller. */
import z from '@deepseek-ai/schemastery'
import type { ServerSnapshot } from './types.ts'

/** Validates finite percentages and safe-integer byte counts at the RPC JSON ingress. */
export const snapshotSchema: z<ServerSnapshot> = z.object({
  cpuPercent: z.union([z.number().min(0).max(100), z.const(null)]),
  memory: z.union([
    z.object({
      usedBytes: z.natural().max(Number.MAX_SAFE_INTEGER).required(),
      totalBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).required(),
    }),
    z.const(null),
  ]),
})

/** Decode an RPC snapshot and reject inconsistent memory totals.
 * @param value Untrusted response value.
 * @returns Validated server readings.
 */
export function parseSnapshot(value: unknown): ServerSnapshot {
  if (typeof value !== 'object' || value === null
    || !('cpuPercent' in value) || value.cpuPercent === undefined
    || !('memory' in value) || value.memory === undefined) {
    throw new Error('server-status: missing snapshot fields')
  }
  const snapshot = z.resolve(value, snapshotSchema, {})[0] as ServerSnapshot
  if (snapshot.cpuPercent !== null && !Number.isFinite(snapshot.cpuPercent)) {
    throw new Error('server-status: invalid CPU percentage')
  }
  if (snapshot.memory !== null && snapshot.memory.usedBytes > snapshot.memory.totalBytes) {
    throw new Error('server-status: invalid memory totals')
  }
  return snapshot
}

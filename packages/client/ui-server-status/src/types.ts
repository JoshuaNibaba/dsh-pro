/** Server-wide readings; null denotes an unavailable measurement. */
export interface ServerSnapshot {
  /** Busy CPU percentage across all OS-reported CPUs, measured between samples. */
  cpuPercent: number | null
  /** Memory in bytes; Linux used memory is MemTotal minus MemAvailable. */
  memory: { usedBytes: number; totalBytes: number } | null
}

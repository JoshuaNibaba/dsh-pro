/** Shared Host sampler regressions. */
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { ServerSampler, parseMeminfo } from '../src/sampler.ts'
import { parseSnapshot } from '../src/wire.ts'

const cpu = (user: number, idle: number) => [{ times: { user, idle, sys: 0, irq: 0, nice: 0 } }]

describe('server CPU deltas and available memory', () => {
  it('withholds the first CPU sample and excludes reclaimable Linux memory', () => {
    let times = cpu(100, 200)
    const sampler = new ServerSampler({ cpus: () => times, platform: () => 'linux', meminfo: () => 'MemTotal: 1024 kB\nMemAvailable: 768 kB\nMemFree: 10 kB\n' })
    expect(sampler.sample()).toEqual({ cpuPercent: null, memory: { totalBytes: 1048576, usedBytes: 262144 } })
    times = cpu(125, 275)
    expect(sampler.sample().cpuPercent).toBe(25)
    expect(sampler.snapshot()).toBe(sampler.snapshot())
    expect(sampler.sample().cpuPercent).toBeNull()
  })

  it('drops CPU baselines after read failure, CPU hotplug and counter rollback', () => {
    let times = cpu(100, 200)
    let failed = false
    const sampler = new ServerSampler({ cpus: () => { if (failed) throw new Error('private OS error'); return times }, platform: () => 'darwin', meminfo: () => { throw new Error('must not read proc') } })
    sampler.sample()
    failed = true
    expect(sampler.sample()).toEqual({ cpuPercent: null, memory: null })
    failed = false
    times = cpu(125, 275)
    expect(sampler.sample().cpuPercent).toBeNull()
    times = cpu(100, 250)
    expect(sampler.sample().cpuPercent).toBeNull()
    times = [...cpu(150, 300), ...cpu(100, 100)]
    expect(sampler.sample().cpuPercent).toBeNull()
    times = []
    expect(sampler.sample().cpuPercent).toBeNull()
  })

  it('averages busy time across all CPUs and isolates memory failures', () => {
    let times = [...cpu(0, 0), ...cpu(0, 0)]
    const sampler = new ServerSampler({ cpus: () => times, platform: () => 'linux', meminfo: () => { throw new Error('private path') } })
    sampler.sample()
    times = [...cpu(100, 0), ...cpu(0, 100)]
    expect(sampler.sample()).toEqual({ cpuPercent: 50, memory: null })
  })

  it.each(['', 'MemTotal: 0 kB\nMemAvailable: 0 kB', 'MemTotal: 10 kB\nMemAvailable: 11 kB', 'MemTotal: 99999999999999999 kB\nMemAvailable: 0 kB'])('rejects unusable proc input %j', (text) => {
    expect(parseMeminfo(text)).toBeNull()
  })

  it.each([
    { usedBytes: Number.MAX_SAFE_INTEGER + 1, totalBytes: Number.MAX_SAFE_INTEGER + 1 },
    { usedBytes: 0, totalBytes: Number.MAX_SAFE_INTEGER + 1 },
    { usedBytes: 1e308, totalBytes: 1e308 },
    { usedBytes: 0, totalBytes: 1e308 },
  ])('rejects unsafe RPC byte counts %j', (memory) => {
    expect(() => parseSnapshot({ cpuPercent: null, memory })).toThrow()
  })

  it('accepts exact safe-integer RPC byte limits', () => {
    const snapshot = { cpuPercent: null, memory: { usedBytes: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER } }
    expect(parseSnapshot(snapshot)).toEqual(snapshot)
  })

  it('validates configuration and RPC numbers at their ingress', () => {
    expect(resolveConfig({})).toEqual({ sampleIntervalMs: 3000, requestTimeoutMs: 5000 })
    expect(() => resolveConfig({ sampleIntervalMs: 0 })).toThrow()
    expect(() => resolveConfig({ requestTimeoutMs: 1.5 })).toThrow()
    expect(() => parseSnapshot({ cpuPercent: 101, memory: null })).toThrow()
    expect(() => parseSnapshot({ cpuPercent: null, memory: { usedBytes: 2, totalBytes: 1 } })).toThrow()
    expect(parseSnapshot({ cpuPercent: null, memory: null })).toEqual({ cpuPercent: null, memory: null })
    expect(() => parseSnapshot({ cpuPercent: null })).toThrow()
    expect(() => parseSnapshot({ memory: null })).toThrow()
    expect(() => parseSnapshot({ cpuPercent: undefined, memory: null })).toThrow()
    expect(() => parseSnapshot({ cpuPercent: NaN, memory: null })).toThrow()
  })
})

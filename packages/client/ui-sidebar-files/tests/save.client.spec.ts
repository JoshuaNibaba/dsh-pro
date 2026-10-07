// @vitest-environment jsdom
/** The browser save hand-off: a named download anchor over a short-lived object URL. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveBlob } from '../src/client/save.ts'

const descriptors = {
  create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
  revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const [key, name] of [['create', 'createObjectURL'], ['revoke', 'revokeObjectURL']] as const) {
    const descriptor = descriptors[key]
    if (descriptor === undefined) Reflect.deleteProperty(URL, name)
    else Object.defineProperty(URL, name, descriptor)
  }
})

describe('saveBlob', () => {
  it('clicks a download anchor named after the file and releases its URL after the browser has read it', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:saved')
    const revoke = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })
    const data = new Blob(['x'])
    saveBlob(data, 'report.pdf')
    expect(create).toHaveBeenCalledWith(data)
    expect(clicked.map(anchor => [anchor.href, anchor.download])).toEqual([['blob:saved', 'report.pdf']])
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(revoke).toHaveBeenCalledWith('blob:saved')
  })
})

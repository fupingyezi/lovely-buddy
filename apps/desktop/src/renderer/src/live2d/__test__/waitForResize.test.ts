import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForResize } from '../waitForResize'

describe('waitForResize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resize 事件到达即 resolve', async () => {
    let settled = false
    void waitForResize().then(() => {
      settled = true
    })
    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })

  it('无 resize 事件：300ms 超时兜底 resolve', async () => {
    let settled = false
    void waitForResize().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(settled).toBe(true)
  })
})

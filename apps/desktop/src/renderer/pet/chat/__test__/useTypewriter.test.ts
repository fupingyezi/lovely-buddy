import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTypewriter } from '@/pet/chat/useTypewriter'

describe('useTypewriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('按 40 字/秒推进（30ms 一 tick，每 tick ≥1 字）', () => {
    const { result } = renderHook(({ t }) => useTypewriter(t), { initialProps: { t: 'abcde' } })
    expect(result.current).toBe('')
    act(() => {
      vi.advanceTimersByTime(120) // 4 tick × 1 字（cps*0.03=1.2 → round=1）
    })
    expect(result.current).toBe('abcd')
    act(() => {
      vi.advanceTimersByTime(30)
    })
    expect(result.current).toBe('abcde') // 追平后停住
  })

  it('目标增长（流式追加）继续追赶', () => {
    const { result, rerender } = renderHook(({ t }) => useTypewriter(t), { initialProps: { t: 'ab' } })
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(result.current).toBe('ab')
    rerender({ t: 'abcdef' })
    act(() => {
      vi.advanceTimersByTime(150) // 5 tick 追平 4 字
    })
    expect(result.current).toBe('abcdef')
  })

  it('目标清空即复位', () => {
    const { result, rerender } = renderHook(({ t }) => useTypewriter(t), { initialProps: { t: 'abc' } })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current).toBe('abc')
    rerender({ t: '' })
    expect(result.current).toBe('')
  })
})

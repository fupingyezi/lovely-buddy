import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetModel } from '../../live2d/model'
import { usePassthrough } from '../usePassthrough'

const setPassthrough = vi.fn()

describe('usePassthrough', () => {
  beforeEach(() => {
    setPassthrough.mockReset()
    vi.stubGlobal('lovelybuddy', { setPassthrough })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('菜单打开时整窗不穿透（首次挂载无条件同步 false）', () => {
    renderHook(() => usePassthrough(null, true))
    expect(setPassthrough).toHaveBeenLastCalledWith(false)
  })

  it('菜单从关到开：cleanup 把穿透置 true 后，新 effect 必须立即改回 false', () => {
    const { rerender } = renderHook(({ menuOpen }: { menuOpen: boolean }) => usePassthrough(null, menuOpen), {
      initialProps: { menuOpen: false }
    })
    setPassthrough.mockClear()

    rerender({ menuOpen: true })
    expect(setPassthrough).toHaveBeenLastCalledWith(false)
  })

  it('菜单从开到关：恢复穿透 true', () => {
    const { rerender } = renderHook(({ menuOpen }: { menuOpen: boolean }) => usePassthrough(null, menuOpen), {
      initialProps: { menuOpen: true }
    })
    setPassthrough.mockClear()

    rerender({ menuOpen: false })
    expect(setPassthrough).toHaveBeenLastCalledWith(true)
  })

  it('hover 模型时关穿透，移出后恢复穿透', () => {
    const pet = { hitTest: (x: number): boolean => x < 100 } as unknown as PetModel
    renderHook(() => usePassthrough(pet, false))
    setPassthrough.mockClear()

    act(() => {
      vi.advanceTimersByTime(51) // lastCheck 初值 0，先越过 50ms 节流
      fireEvent.pointerMove(window, { clientX: 50, clientY: 50 })
    })
    expect(setPassthrough).toHaveBeenLastCalledWith(false)

    act(() => {
      vi.advanceTimersByTime(51) // 越过 50ms 节流
      fireEvent.pointerMove(window, { clientX: 500, clientY: 50 })
    })
    expect(setPassthrough).toHaveBeenLastCalledWith(true)
  })
})

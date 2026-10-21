import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePetMenu } from '../usePetMenu'

const MENU_W = 280
const MENU_H = 520

const expandWindow = vi.fn()
const collapseWindow = vi.fn()
const setPassthrough = vi.fn()

function mockLovelybuddy(): void {
  expandWindow.mockReset().mockResolvedValue({ width: window.innerWidth, height: window.innerHeight })
  collapseWindow.mockReset()
  setPassthrough.mockReset()
  vi.stubGlobal('lovelybuddy', { expandWindow, collapseWindow, setPassthrough })
}

/** 重设 jsdom 窗口尺寸（默认 1024x768） */
function setWindowSize(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
}

describe('usePetMenu', () => {
  beforeEach(() => {
    setWindowSize(1024, 768)
    mockLovelybuddy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('窗口足够大时不扩展，菜单直接放点击处', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu(100, 120))

    await waitFor(() => expect(result.current.menu).toEqual({ x: 100, y: 120 }))
    expect(expandWindow).not.toHaveBeenCalled()
  })

  it('窗口装不下菜单时先扩展，再按主进程返回的实际尺寸夹紧菜单', async () => {
    setWindowSize(200, 300)
    mockLovelybuddy()
    expandWindow.mockResolvedValue({ width: 300, height: 500 }) // 主进程被屏幕边缘夹紧后的实际尺寸
    const { result } = renderHook(() => usePetMenu())

    act(() => result.current.openMenu(150, 200))

    // 需要的扩展量 = 点击处 + 菜单尺寸 + 8px 边距 - 窗口尺寸
    expect(expandWindow).toHaveBeenCalledWith(150 + MENU_W + 8 - 200, 200 + MENU_H + 8 - 300)
    await waitFor(() => {
      // x 夹紧到 300 - 280 - 8 = 12；y 越界 → 顶到 4
      expect(result.current.menu).toEqual({ x: 12, y: 4 })
    })
  })

  it('closeMenu 缩回窗口并恢复穿透', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu(100, 120))
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    act(() => result.current.closeMenu())
    expect(result.current.menu).toBeNull()
    expect(collapseWindow).toHaveBeenCalledTimes(1)
    expect(setPassthrough).toHaveBeenCalledWith(true)
  })

  it('点菜单外（data-interactive 之外）关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu(100, 120))
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    fireEvent.pointerDown(document.body)
    expect(result.current.menu).toBeNull()
  })

  it('Esc 关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu(100, 120))
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.menu).toBeNull()
  })

  it('点开又立刻关掉：扩展结果返回后菜单保持关闭（令牌失效）', async () => {
    setWindowSize(200, 300) // 窗口装不下菜单 → 走 expandWindow 路径
    let resolveExpand!: (size: { width: number; height: number }) => void
    expandWindow.mockImplementation(
      () =>
        new Promise<{ width: number; height: number }>((resolve) => {
          resolveExpand = resolve
        })
    )
    const { result } = renderHook(() => usePetMenu())

    act(() => result.current.openMenu(150, 200))
    act(() => result.current.closeMenu())
    await act(async () => {
      resolveExpand({ width: 400, height: 800 })
      await Promise.resolve()
    })

    expect(result.current.menu).toBeNull()
  })
})

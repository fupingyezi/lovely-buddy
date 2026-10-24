import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePetMenu } from '../usePetMenu'
import { MENU_REQUIRED_H, MENU_REQUIRED_W } from '../../pet/menuLayout'

const expandMenu = vi.fn()
const collapseWindow = vi.fn()
const setPassthrough = vi.fn()

function mockLovelybuddy(): void {
  expandMenu.mockReset().mockResolvedValue({ width: 400, height: 800 })
  collapseWindow.mockReset()
  setPassthrough.mockReset()
  vi.stubGlobal('lovelybuddy', { expandMenu, collapseWindow, setPassthrough })
}

describe('usePetMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockLovelybuddy()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('openMenu 用菜单需求尺寸请求主进程权威扩展，resize 落地后 menuOpen=true', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    expect(expandMenu).toHaveBeenCalledWith(MENU_REQUIRED_W, MENU_REQUIRED_H)
    // expand 已 resolve 但 resize 未落地：菜单先不显示（防首帧错位闪烁）
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.menuOpen).toBe(false)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.menuOpen).toBe(true)
  })

  it('扩展被屏幕夹紧无 resize 事件：300ms 超时后照常打开', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(result.current.menuOpen).toBe(true)
  })

  it('closeMenu 缩回窗口并恢复穿透', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    act(() => {
      result.current.closeMenu()
    })
    expect(result.current.menuOpen).toBe(false)
    expect(collapseWindow).toHaveBeenCalledWith('menu')
    expect(setPassthrough).toHaveBeenCalledWith(true)
  })

  it('点开又立刻关掉：resize 落地后菜单保持关闭（令牌失效）', async () => {
    let resolveExpand!: (size: { width: number; height: number }) => void
    expandMenu.mockImplementation(
      () =>
        new Promise<{ width: number; height: number }>((resolve) => {
          resolveExpand = resolve
        })
    )
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    act(() => {
      result.current.closeMenu()
    })
    await act(async () => {
      resolveExpand({ width: 400, height: 800 })
      await Promise.resolve()
    })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.menuOpen).toBe(false)
  })

  it('点菜单外（data-interactive 之外）关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    fireEvent.pointerDown(document.body)
    expect(result.current.menuOpen).toBe(false)
  })

  it('点 data-interactive 内不关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    const panel = document.createElement('div')
    panel.setAttribute('data-interactive', '')
    document.body.appendChild(panel)
    fireEvent.pointerDown(panel)
    expect(result.current.menuOpen).toBe(true)
    panel.remove()
  })

  it('Esc 关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.menuOpen).toBe(false)
  })
})

import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePetMenu } from '../usePetMenu'
import { MENU_H, MENU_W } from '../menuLayout'

const expandWindow = vi.fn()
const collapseWindow = vi.fn()
const setPassthrough = vi.fn()

function mockLovelybuddy(): void {
  expandWindow.mockReset().mockResolvedValue({ width: 1024, height: 1024 })
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
    setWindowSize(164, 227) // haru 模型窗口
    mockLovelybuddy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('openMenu 按布局扩展窗口，完成后菜单放 (4,4)', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())

    expect(expandWindow).toHaveBeenCalledWith('menu', MENU_W + 4 - 164, MENU_H + 12)
    await waitFor(() => expect(result.current.menu).toEqual({ x: 4, y: 4 }))
  })

  it('宽窗口只向上扩展', async () => {
    setWindowSize(400, 227)
    mockLovelybuddy()
    const { result } = renderHook(() => usePetMenu())

    act(() => result.current.openMenu())
    expect(expandWindow).toHaveBeenCalledWith('menu', 0, MENU_H + 12)
    await waitFor(() => expect(result.current.menu).toEqual({ x: 4, y: 4 }))
  })

  it('closeMenu 缩回窗口并恢复穿透', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    act(() => result.current.closeMenu())
    expect(result.current.menu).toBeNull()
    expect(collapseWindow).toHaveBeenCalledTimes(1)
    expect(setPassthrough).toHaveBeenCalledWith(true)
  })

  it('点菜单外（data-interactive 之外）关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    fireEvent.pointerDown(document.body)
    expect(result.current.menu).toBeNull()
  })

  it('点 data-interactive 内不关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    const panel = document.createElement('div')
    panel.setAttribute('data-interactive', '')
    document.body.appendChild(panel)
    fireEvent.pointerDown(panel)
    expect(result.current.menu).not.toBeNull()
    panel.remove()
  })

  it('Esc 关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.menu).toBeNull()
  })

  it('点开又立刻关掉：扩展结果返回后菜单保持关闭（令牌失效）', async () => {
    let resolveExpand!: (size: { width: number; height: number }) => void
    expandWindow.mockImplementation(
      () =>
        new Promise<{ width: number; height: number }>((resolve) => {
          resolveExpand = resolve
        })
    )
    const { result } = renderHook(() => usePetMenu())

    act(() => result.current.openMenu())
    act(() => result.current.closeMenu())
    await act(async () => {
      resolveExpand({ width: 400, height: 800 })
      await Promise.resolve()
    })

    expect(result.current.menu).toBeNull()
  })
})

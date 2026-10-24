import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePetMenu } from '../usePetMenu'
import { MENU_REQUIRED_W, menuRequiredHeight } from '../../pet/menuLayout'
import { usePetStore } from '../../store/petStore'

// AvatarInfo 是 env.d.ts 的全局类型（declare global），不从 assetsApi import
const models3: AvatarInfo[] = [
  {
    slug: 'haru',
    name: 'haru-cubism4',
    url: 'l2d://model/haru/haru.model3.json',
    kind: 'moc3',
    entry: 'haru/haru.model3.json'
  },
  {
    slug: 'shizuku',
    name: 'shizuku-cubism2',
    url: 'l2d://model/shizuku/shizuku.model.json',
    kind: 'moc',
    entry: 'shizuku/shizuku.model.json'
  },
  {
    slug: 'third',
    name: 'third',
    url: 'l2d://model/third/third.model3.json',
    kind: 'moc3',
    entry: 'third/third.model3.json'
  }
]

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
    usePetStore.setState({ models: models3 })
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
    expect(expandMenu).toHaveBeenCalledWith(MENU_REQUIRED_W, menuRequiredHeight(3))
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

  it('单形象紧凑态扩展量更小（menuRequiredHeight(1)=99）', async () => {
    usePetStore.setState({ models: models3.slice(0, 1) })
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    expect(expandMenu).toHaveBeenCalledWith(MENU_REQUIRED_W, menuRequiredHeight(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
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

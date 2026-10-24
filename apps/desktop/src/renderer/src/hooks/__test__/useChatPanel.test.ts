import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatPanel, CHAT_W, CHAT_H } from '../useChatPanel'
import { BUBBLE_HOLD_MS } from '../../pet/chat/bubbleTiming'
import { useChatStore } from '../../store/chatStore'

const expandWindow = vi.fn()
const collapseWindow = vi.fn()
const setPassthrough = vi.fn()

function mockLovelybuddy(): void {
  expandWindow.mockReset().mockResolvedValue({ width: 940, height: 600 })
  collapseWindow.mockReset()
  setPassthrough.mockReset()
  vi.stubGlobal('lovelybuddy', { expandWindow, collapseWindow, setPassthrough })
}

type PanelHook = ReturnType<typeof useChatPanel>

/** fake timers 下等 expandWindow promise 落定：act 内 await 冲掉微任务 */
async function openPanelOf(result: { current: PanelHook }): Promise<void> {
  await act(async () => {
    result.current.openPanel()
  })
  expect(result.current.open).toBe(true)
}

describe('useChatPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockLovelybuddy()
    useChatStore.setState({ sending: false })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('扩展尺寸为 520×120（输入条 64 + 错误行 24 + 边距与头顶呼吸）', () => {
    expect(CHAT_W).toBe(520)
    expect(CHAT_H).toBe(120)
  })

  it('openPanel 用 chat 键位向左上扩展 CHAT_W×CHAT_H，完成后 open=true', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    expect(expandWindow).toHaveBeenCalledWith('chat', CHAT_W, CHAT_H)
  })

  it('closePanel 不立即缩回：气泡期保持扩展，BUBBLE_HOLD_MS 后缩回（不再强制穿透）', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    act(() => result.current.closePanel())
    expect(result.current.open).toBe(false)
    expect(collapseWindow).not.toHaveBeenCalled() // 气泡可能还在展示：保持扩展
    act(() => vi.advanceTimersByTime(BUBBLE_HOLD_MS))
    expect(collapseWindow).toHaveBeenCalledWith('chat')
    expect(setPassthrough).not.toHaveBeenCalled() // 延迟收起不再强制穿透（穿透由 usePassthrough 状态机管）
  })

  it('面板关闭但流式中：保持扩展；流式结束走完气泡期才缩回', async () => {
    const { result } = renderHook(() => useChatPanel())
    useChatStore.setState({ sending: true })
    await openPanelOf(result)
    act(() => result.current.closePanel())
    expect(result.current.open).toBe(false)
    expect(collapseWindow).not.toHaveBeenCalled() // sending=true 保持扩展（气泡要空间）
    act(() => useChatStore.setState({ sending: false }))
    expect(collapseWindow).not.toHaveBeenCalled() // 气泡保持期内
    act(() => vi.advanceTimersByTime(BUBBLE_HOLD_MS))
    expect(collapseWindow).toHaveBeenCalledWith('chat')
  })

  it('气泡期内重开面板：取消定时器，计时结束后不缩回', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    act(() => result.current.closePanel())
    await openPanelOf(result) // 重开：取消待执行的收起
    act(() => vi.advanceTimersByTime(BUBBLE_HOLD_MS))
    expect(collapseWindow).not.toHaveBeenCalled()
  })

  it('气泡期内再次流式（sending→true）：取消定时器', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    act(() => result.current.closePanel())
    act(() => useChatStore.setState({ sending: true }))
    act(() => vi.advanceTimersByTime(BUBBLE_HOLD_MS))
    expect(collapseWindow).not.toHaveBeenCalled()
  })

  it('Esc / 点面板外关闭', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.open).toBe(false)
  })

  it('流式成功结束自动收起面板（气泡接管展示）', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    act(() => {
      useChatStore.setState({ items: [{ role: 'assistant', content: '回复' }], sending: true, error: null })
    })
    act(() => useChatStore.setState({ sending: false }))
    expect(result.current.open).toBe(false)
    expect(collapseWindow).not.toHaveBeenCalled() // 气泡保持期
    act(() => vi.advanceTimersByTime(BUBBLE_HOLD_MS))
    expect(collapseWindow).toHaveBeenCalledWith('chat')
  })

  it('出错不自动收起（错误行+重试留在面板）', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    act(() => {
      useChatStore.setState({ sending: true })
    })
    act(() => useChatStore.setState({ sending: false, error: '后端离线' }))
    expect(result.current.open).toBe(true)
  })

  it('空回复不自动收起', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    act(() => {
      useChatStore.setState({ items: [{ role: 'user', content: '嗨' }], sending: true })
    })
    act(() => useChatStore.setState({ sending: false }))
    expect(result.current.open).toBe(true)
  })
})

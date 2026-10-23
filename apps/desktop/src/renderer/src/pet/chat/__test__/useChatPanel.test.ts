import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatPanel, CHAT_H } from '../useChatPanel'
import { useChatStore } from '../../../store/chatStore'

const expandWindow = vi.fn()
const collapseWindow = vi.fn()
const setPassthrough = vi.fn()

function mockLovelybuddy(): void {
  expandWindow.mockReset().mockResolvedValue({ width: 400, height: 800 })
  collapseWindow.mockReset()
  setPassthrough.mockReset()
  vi.stubGlobal('lovelybuddy', { expandWindow, collapseWindow, setPassthrough })
}

describe('useChatPanel', () => {
  beforeEach(() => {
    mockLovelybuddy()
    useChatStore.setState({ sending: false })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('openPanel 用 chat 键位向上扩展 CHAT_H，完成后 open=true', async () => {
    const { result } = renderHook(() => useChatPanel())
    act(() => result.current.openPanel())
    expect(expandWindow).toHaveBeenCalledWith('chat', 0, CHAT_H)
    await waitFor(() => expect(result.current.open).toBe(true))
  })

  it('closePanel 缩回并恢复穿透', async () => {
    const { result } = renderHook(() => useChatPanel())
    act(() => result.current.openPanel())
    await waitFor(() => expect(result.current.open).toBe(true))
    act(() => result.current.closePanel())
    expect(result.current.open).toBe(false)
    expect(collapseWindow).toHaveBeenCalledWith('chat')
    expect(setPassthrough).toHaveBeenCalledWith(true)
  })

  it('面板关闭但流式中：保持扩展；流式结束：自动缩回', async () => {
    const { result } = renderHook(() => useChatPanel())
    useChatStore.setState({ sending: true })
    act(() => result.current.openPanel())
    await waitFor(() => expect(result.current.open).toBe(true))
    act(() => result.current.closePanel())
    expect(result.current.open).toBe(false)
    expect(collapseWindow).not.toHaveBeenCalled() // sending=true 保持扩展（气泡要空间）
    act(() => useChatStore.setState({ sending: false }))
    await waitFor(() => expect(collapseWindow).toHaveBeenCalledWith('chat'))
  })

  it('Esc / 点面板外关闭', async () => {
    const { result } = renderHook(() => useChatPanel())
    act(() => result.current.openPanel())
    await waitFor(() => expect(result.current.open).toBe(true))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.open).toBe(false)
  })
})

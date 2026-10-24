import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SpeechBubble from '../SpeechBubble'
import { useChatStore } from '../../../store/chatStore'
import { setActiveModel } from '../../../live2d/modelBus'
import { useWindowGeometry } from '../../../live2d/windowGeometry'
import type { PetModel } from '../../../live2d/model'

const playIntent = vi.fn()
const fakePet = { playIntent, anchor: { x: 0, y: 120 } } as unknown as PetModel

describe('SpeechBubble', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    playIntent.mockReset().mockResolvedValue(true)
    fakePet.anchor = { x: 0, y: 120 }
    setActiveModel(fakePet)
    useWindowGeometry.setState({ size: { w: 300, h: 700 }, base: { w: 300, h: 580 } })
    useChatStore.setState({ items: [], sending: false, error: null, lastMotion: null, replySeq: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
    setActiveModel(null)
    useWindowGeometry.setState({ size: { w: 1024, h: 768 }, base: null })
  })

  it('启动恢复历史（replySeq=0）：不渲染气泡，也不排淡出计时', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好' }] })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(9000)
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
  })

  it('本会话流式回复：弹出打字机，8s 静默后淡出卸载', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好呀，我在' }], sending: true, replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(200) // 打字机推进
    })
    expect(container.querySelector('.speech-bubble-body')!.textContent).toContain('你')
    act(() => {
      useChatStore.setState({ sending: false }) // 流式结束，起 8s 计时
    })
    act(() => {
      vi.advanceTimersByTime(8100)
    })
    expect(container.querySelector('.speech-bubble--out')).toBeTruthy() // 淡出中
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(container.querySelector('.speech-bubble')).toBeNull() // 卸载
  })

  it('完整展示过的回复：历史刷新（内容变化、replySeq 不变）不重放', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '旧回复' }], replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    act(() => {
      vi.advanceTimersByTime(8300) // 淡出完成，标记已展示
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
    act(() => {
      useChatStore.setState({ items: [{ role: 'assistant', content: '刷新后的历史' }], replySeq: 1 })
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
  })

  it('面板打开时不渲染；面板关闭后同一回复重新弹出', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好' }], replySeq: 1 })
    const { container, rerender } = render(<SpeechBubble panelOpen={true} />)
    expect(container.querySelector('.speech-bubble')).toBeNull()
    rerender(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble')).toBeTruthy()
  })

  it('motion 事件驱动当前模型播动作', () => {
    useChatStore.setState({
      items: [{ role: 'assistant', content: '哈' }],
      sending: true,
      replySeq: 1,
      lastMotion: { intent: 'happy', seq: 1 }
    })
    render(<SpeechBubble panelOpen={false} />)
    expect(playIntent).toHaveBeenCalledWith('happy')
  })

  it('非法意图不触发动作', () => {
    useChatStore.setState({
      items: [{ role: 'assistant', content: '哈' }],
      sending: true,
      replySeq: 1,
      lastMotion: { intent: 'dance', seq: 2 }
    })
    render(<SpeechBubble panelOpen={false} />)
    expect(playIntent).not.toHaveBeenCalled()
  })

  it('尾巴锚定模型头部左上角（几何 store 换算 right/bottom）', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '嗨' }], sending: true, replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    const el = container.querySelector('.speech-bubble') as HTMLElement
    expect(el.style.right).toBe('276px') // 300 - 0 - TAIL_INSET(24)
    expect(el.style.bottom).toBe('604px') // 700 - 120 + 16 + 8
    expect(el.style.maxHeight).toBe('88px') // 120 - 16 - 8 - 8
  })

  it('窗口扩展后布局随几何 store 更新：气泡仍贴头顶不漂移（回归：监听顺序竞态）', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '嗨' }], sending: true, replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    // 聊天扩展 520×120 + 菜单扩展 0×332 落地：窗口 820×1152，模型位移后 anchor.y=452
    act(() => {
      useWindowGeometry.setState({ size: { w: 820, h: 1152 }, base: { w: 300, h: 580 } })
      fakePet.anchor = { x: 520, y: 452 }
    })
    const el = container.querySelector('.speech-bubble') as HTMLElement
    expect(el.style.bottom).toBe('724px') // 1152 - 452 + 24：贴头顶；旧实现会算出 1152-120+24=1056 漂到窗口顶
  })

  it('无模型时回退居中样式', () => {
    setActiveModel(null)
    useChatStore.setState({ items: [{ role: 'assistant', content: '嗨' }], sending: true, replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble--center')).toBeTruthy()
  })
})

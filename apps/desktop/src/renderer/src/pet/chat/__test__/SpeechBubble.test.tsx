import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SpeechBubble from '../SpeechBubble'
import { useChatStore } from '../../../store/chatStore'
import { setActiveModel } from '../../../live2d/modelBus'
import type { PetModel } from '../../../live2d/model'

const playIntent = vi.fn()
const fakePet = { playIntent, anchor: { x: 0, y: 120 } } as unknown as PetModel

describe('SpeechBubble', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    playIntent.mockReset().mockResolvedValue(true)
    setActiveModel(fakePet)
    useChatStore.setState({ items: [], sending: false, error: null, lastMotion: null })
  })
  afterEach(() => {
    vi.useRealTimers()
    setActiveModel(null)
  })

  it('无回复 / 面板打开时不渲染', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好' }] })
    const { container, rerender } = render(<SpeechBubble panelOpen={false} />)
    // 有回复但流式已结束且超过 8s → 淡出（out 相位）→ 200ms 后卸载
    act(() => {
      vi.advanceTimersByTime(8300) // 8000 触发 out，+200 淡出完成卸载
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
    rerender(<SpeechBubble panelOpen={true} />)
    // 面板打开：最近回复变化也不显示
    useChatStore.setState({ items: [{ role: 'assistant', content: '新回复' }] })
    expect(container.querySelector('.speech-bubble')).toBeNull()
  })

  it('流式中显示打字机文本，8s 静默后淡出并卸载', async () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好呀，我在' }], sending: true })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(200) // 打字机推进
    })
    expect(container.querySelector('.speech-bubble-body')!.textContent).toContain('你')
    act(() => {
      useChatStore.setState({ sending: false }) // 流式结束，effect 在 act 末才注册 8s 计时
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

  it('motion 事件驱动当前模型播动作', () => {
    useChatStore.setState({
      items: [{ role: 'assistant', content: '哈' }],
      sending: true,
      lastMotion: { intent: 'happy', seq: 1 }
    })
    render(<SpeechBubble panelOpen={false} />)
    expect(playIntent).toHaveBeenCalledWith('happy')
  })

  it('非法意图不触发动作', () => {
    useChatStore.setState({
      items: [{ role: 'assistant', content: '哈' }],
      sending: true,
      lastMotion: { intent: 'dance', seq: 2 }
    })
    render(<SpeechBubble panelOpen={false} />)
    expect(playIntent).not.toHaveBeenCalled()
  })

  it('尾巴锚定模型头部左上角（窗口坐标换算为 right/bottom 偏移）', () => {
    Object.defineProperty(window, 'innerWidth', { value: 300, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true })
    useChatStore.setState({ items: [{ role: 'assistant', content: '嗨' }], sending: true })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    const el = container.querySelector('.speech-bubble') as HTMLElement
    expect(el.style.right).toBe('276px') // 300 - 0 - TAIL_INSET(24)
    expect(el.style.bottom).toBe('604px') // 700 - 120 + 16 + 8
    expect(el.style.maxHeight).toBe('88px') // 120 - 16 - 8 - 8
  })

  it('无模型时回退居中样式', () => {
    setActiveModel(null)
    useChatStore.setState({ items: [{ role: 'assistant', content: '嗨' }], sending: true })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble--center')).toBeTruthy()
  })
})

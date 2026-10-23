import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SpeechBubble from '../SpeechBubble'
import { useChatStore } from '../../../store/chatStore'
import { setActiveModel } from '../../../live2d/modelBus'
import type { PetModel } from '../../../live2d/model'

const playIntent = vi.fn()
const fakePet = { playIntent } as unknown as PetModel

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
    // 有回复但流式已结束且超过 8s → 隐藏（初始挂载即显示，推进 8s 后隐藏）
    act(() => {
      vi.advanceTimersByTime(8100)
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
    rerender(<SpeechBubble panelOpen={true} />)
    // 面板打开：最近回复变化也不显示
    useChatStore.setState({ items: [{ role: 'assistant', content: '新回复' }] })
    expect(container.querySelector('.speech-bubble')).toBeNull()
  })

  it('流式中显示打字机文本，8s 静默后隐藏', async () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好呀，我在' }], sending: true })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(200) // 打字机推进
    })
    expect(container.querySelector('.speech-bubble')!.textContent).toContain('你')
    act(() => {
      useChatStore.setState({ sending: false }) // 流式结束，effect 在 act 末才注册 8s 计时
    })
    act(() => {
      vi.advanceTimersByTime(8100)
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
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
})

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from '../ChatPanel'
import { useChatStore } from '../../../store/chatStore'
import { usePetStore } from '../../../store/petStore'

const sendMock = vi.fn()
const stopMock = vi.fn()

describe('ChatPanel', () => {
  beforeEach(() => {
    sendMock.mockReset()
    stopMock.mockReset()
    useChatStore.setState({ items: [], sending: false, error: null, send: sendMock, stop: stopMock })
    usePetStore.setState({
      models: [
        { slug: 'haru', name: 'haru', url: 'l2d://model/haru/x.model3.json', kind: 'moc3', entry: 'haru/x.model3.json' }
      ],
      modelUrl: 'l2d://model/haru/x.model3.json',
      modelName: 'haru'
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('渲染历史与空态提示', () => {
    useChatStore.setState({
      items: [
        { role: 'user', content: '嗨' },
        { role: 'assistant', content: '你好呀', motion: 'happy' }
      ]
    })
    render(<ChatPanel onClose={() => {}} />)
    expect(screen.getByText('嗨')).toBeTruthy()
    expect(screen.getByText('你好呀')).toBeTruthy()
  })

  it('Enter 发送（带当前形象 slug），输入框清空；IME 组词中的 Enter 不发送', () => {
    render(<ChatPanel onClose={() => {}} />)
    const input = screen.getByPlaceholderText('按 Enter 发送') as HTMLInputElement
    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true } as EventInit)
    expect(sendMock).not.toHaveBeenCalled() // 组词中
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sendMock).toHaveBeenCalledWith('你好', 'haru')
    expect(input.value).toBe('')
  })

  it('流式中显示停止按钮并调用 stop', () => {
    useChatStore.setState({ sending: true })
    render(<ChatPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(stopMock).toHaveBeenCalled()
  })

  it('错误信息展示', () => {
    useChatStore.setState({ error: '未配置 API key' })
    render(<ChatPanel onClose={() => {}} />)
    expect(screen.getByText('未配置 API key')).toBeTruthy()
  })
})

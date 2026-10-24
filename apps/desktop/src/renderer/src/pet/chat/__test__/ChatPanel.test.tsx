import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from '../ChatPanel'
import { useChatStore } from '../../../store/chatStore'
import { usePetStore } from '../../../store/petStore'

const sendMock = vi.fn()
const stopMock = vi.fn()
const retryMock = vi.fn()

describe('ChatPanel', () => {
  beforeEach(() => {
    sendMock.mockReset()
    stopMock.mockReset()
    retryMock.mockReset()
    useChatStore.setState({ items: [], sending: false, error: null, send: sendMock, stop: stopMock, retry: retryMock })
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

  it('状态 A 默认：占位符提示、发送键降饱和禁用', () => {
    render(<ChatPanel />)
    expect(screen.getByPlaceholderText('和我说点什么…')).toBeTruthy()
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('状态 B 输入中：计数 + 发送可用；Enter 发送（带当前形象 slug）并清空；IME 组词中不发送', () => {
    render(<ChatPanel />)
    const input = screen.getByPlaceholderText('和我说点什么…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '你好' } })
    expect(screen.getByText('2/4000 个字')).toBeTruthy()
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true } as EventInit)
    expect(sendMock).not.toHaveBeenCalled() // 组词中
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sendMock).toHaveBeenCalledWith('你好', 'haru')
    expect(input.value).toBe('')
  })

  it('状态 C 生成中：输入禁用、占位「回复中…」、停止键可点', () => {
    useChatStore.setState({ sending: true })
    render(<ChatPanel />)
    const input = screen.getByPlaceholderText('回复中…') as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(stopMock).toHaveBeenCalled()
  })

  it('maxLength 4000 与后端一致', () => {
    render(<ChatPanel />)
    expect((screen.getByPlaceholderText('和我说点什么…') as HTMLInputElement).maxLength).toBe(4000)
  })

  it('错误态：输入条下方一行提示，点击重试', () => {
    useChatStore.setState({ error: '后端离线' })
    render(<ChatPanel />)
    fireEvent.click(screen.getByRole('button', { name: '后端离线·点击重试' }))
    expect(retryMock).toHaveBeenCalled()
  })
})

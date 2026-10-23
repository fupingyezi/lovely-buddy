import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chatStore'

// mock chatApi：捕获 onEvent，由测试手动驱动事件流
const streamChatMock = vi.fn()
const getHistoryMock = vi.fn()
vi.mock('../../lib/chatApi', () => ({
  streamChat: (...args: unknown[]) => streamChatMock(...args),
  getHistory: (...args: unknown[]) => getHistoryMock(...args)
}))

function driveSend(events: object[]): Promise<void> {
  streamChatMock.mockImplementation(
    (_rt: unknown, _body: unknown, onEvent: (ev: object) => void) => {
      for (const e of events) onEvent(e)
      return Promise.resolve()
    }
  )
  return useChatStore.getState().send('嗨', 'haru')
}

beforeEach(() => {
  useChatStore.setState({ items: [], sessionId: null, sending: false, error: null, lastMotion: null })
  streamChatMock.mockReset()
  getHistoryMock.mockReset()
  vi.stubGlobal('lovelybuddy', { getRuntime: () => Promise.resolve({ baseUrl: 'http://x', token: 't' }) })
})

afterEach(() => vi.unstubAllGlobals())

describe('chatStore.send', () => {
  it('乐观插入 user + assistant 占位，delta 累加，done 收口', async () => {
    await driveSend([
      { type: 'meta', session_id: 's1' },
      { type: 'delta', text: '你' },
      { type: 'delta', text: '好' },
      { type: 'motion', intent: 'happy' },
      { type: 'done', text: '你好', motion: 'happy' }
    ])
    const s = useChatStore.getState()
    expect(s.sessionId).toBe('s1')
    expect(s.items).toEqual([
      { role: 'user', content: '嗨' },
      { role: 'assistant', content: '你好', motion: 'happy' }
    ])
    expect(s.sending).toBe(false)
    expect(s.lastMotion).toMatchObject({ intent: 'happy' })
  })

  it('sending 期间重复 send 被忽略', async () => {
    streamChatMock.mockImplementation(() => new Promise<void>(() => {})) // 永不完成
    const p1 = useChatStore.getState().send('第一条')
    await useChatStore.getState().send('第二条')
    expect(useChatStore.getState().items).toHaveLength(2) // 只有第一条的 user+占位
    void p1
  })

  it('error 事件置错误并移除空占位', async () => {
    await driveSend([{ type: 'meta', session_id: 's1' }, { type: 'error', error: '未配置 API key' }])
    const s = useChatStore.getState()
    expect(s.error).toBe('未配置 API key')
    expect(s.items).toEqual([{ role: 'user', content: '嗨' }])
  })

  it('stop 触发 abort（保留半截内容，不算错误）', async () => {
    streamChatMock.mockImplementation(
      (_rt: unknown, _body: unknown, _onEvent: unknown, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          const abortIt = (): void => reject(new DOMException('aborted', 'AbortError'))
          // stop() 可能先于 streamChat 调用（send 先 await getRuntime）：已 abort 的信号不补发事件
          if (signal.aborted) abortIt()
          else signal.addEventListener('abort', abortIt)
        })
    )
    const p = useChatStore.getState().send('长问题')
    // 模拟流式中已收到部分内容
    useChatStore.setState((s) => ({
      items: [...s.items.slice(0, -1), { role: 'assistant' as const, content: '半截' }]
    }))
    useChatStore.getState().stop()
    await p
    const s = useChatStore.getState()
    expect(s.sending).toBe(false)
    expect(s.error).toBeNull()
    expect(s.items[s.items.length - 1]).toEqual({ role: 'assistant', content: '半截' })
  })
})

describe('chatStore.refresh', () => {
  it('拉取历史覆盖 items', async () => {
    getHistoryMock.mockResolvedValue({
      session_id: 's1',
      messages: [
        { role: 'user', content: '嗨', created_at: 't' },
        { role: 'assistant', content: '你好', motion: 'happy', created_at: 't' }
      ]
    })
    await useChatStore.getState().refresh()
    const s = useChatStore.getState()
    expect(s.sessionId).toBe('s1')
    expect(s.items).toEqual([
      { role: 'user', content: '嗨' },
      { role: 'assistant', content: '你好', motion: 'happy' }
    ])
  })

  it('后端离线时保持现状不抛错', async () => {
    getHistoryMock.mockRejectedValue(new Error('offline'))
    useChatStore.setState({ items: [{ role: 'user', content: '旧' }] })
    await expect(useChatStore.getState().refresh()).resolves.toBeUndefined()
    expect(useChatStore.getState().items).toHaveLength(1)
  })
})

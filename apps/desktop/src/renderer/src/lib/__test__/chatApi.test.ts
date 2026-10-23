import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHistory, parseSSEBlock, streamChat } from '../chatApi'
import type { ApiRuntime } from '../assetsApi'

const rt: ApiRuntime = { baseUrl: 'http://127.0.0.1:8740', token: 'dev' }

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    }
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('parseSSEBlock', () => {
  it('解析 data 行为事件对象', () => {
    expect(parseSSEBlock('event: delta\ndata: {"type":"delta","text":"你"}')).toEqual({
      type: 'delta',
      text: '你'
    })
  })
  it('无 data / 坏 JSON / 未知类型 → null', () => {
    expect(parseSSEBlock('event: ping')).toBeNull()
    expect(parseSSEBlock('data: not-json')).toBeNull()
    expect(parseSSEBlock('data: {"type":"weird"}')).toBeNull()
  })
})

describe('streamChat', () => {
  afterEach(() => vi.restoreAllMocks())

  it('按块解析事件并回调（跨 chunk 的 SSE 块）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: meta\ndata: {"type":"meta","session_id":"s1"}\n\n',
        'event: delta\ndata: {"type":"delta","text":"你"}\n\nevent: mot',
        'ion\ndata: {"type":"motion","intent":"happy"}\n\nevent: done\ndata: {"type":"done","text":"你","motion":"happy"}\n\n'
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const events: unknown[] = []
    await streamChat(rt, { message: 'hi' }, (ev) => events.push(ev))
    expect(events.map((e) => (e as { type: string }).type)).toEqual(['meta', 'delta', 'motion', 'done'])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8740/api/v1/chat',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('HTTP 400 抛服务端错误信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"message 必填"}', { status: 400 }))
    )
    await expect(streamChat(rt, { message: '' }, () => {})).rejects.toThrow('message 必填')
  })
})

describe('getHistory', () => {
  afterEach(() => vi.restoreAllMocks())

  it('映射历史消息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          '{"session_id":"s1","messages":[{"role":"user","content":"嗨","created_at":"2026-10-23T00:00:00Z"},{"role":"assistant","content":"你好呀","motion":"happy","created_at":"2026-10-23T00:00:01Z"}]}',
          { status: 200 }
        )
      )
    )
    const h = await getHistory(rt)
    expect(h.session_id).toBe('s1')
    expect(h.messages).toHaveLength(2)
    expect(h.messages[1]?.motion).toBe('happy')
  })
})

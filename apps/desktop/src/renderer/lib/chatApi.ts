// 聊天 API 客户端：POST /api/v1/chat 读 SSE 流（fetch + ReadableStream 手解，
// EventSource 不支持 POST/鉴权头），事件对象与 Go service.Event 的 JSON 对齐。
import type { ApiRuntime } from '@/lib/assetsApi'

export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
  motion?: string
  created_at: string
}

export type ChatStreamEvent =
  | { type: 'meta'; session_id: string }
  | { type: 'delta'; text: string }
  | { type: 'motion'; intent: string }
  | { type: 'done'; text: string; motion?: string }
  | { type: 'error'; error: string }

const EVENT_TYPES = ['meta', 'delta', 'motion', 'done', 'error']

/** 解析一个 SSE 块（"event: x\ndata: y"）→ 事件对象；无 data/坏 JSON/未知类型 → null。 */
export function parseSSEBlock(block: string): ChatStreamEvent | null {
  const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) return null
  try {
    const ev = JSON.parse(dataLine.slice(5).trim()) as ChatStreamEvent
    if (!EVENT_TYPES.includes(ev.type)) return null
    return ev
  } catch {
    return null
  }
}

export async function streamChat(
  rt: ApiRuntime,
  body: { avatar?: string; message: string },
  onEvent: (ev: ChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${rt.baseUrl}/api/v1/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rt.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `发送失败: HTTP ${res.status}`)
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const ev = parseSSEBlock(block)
      if (ev) onEvent(ev)
    }
  }
}

export async function getHistory(
  rt: ApiRuntime,
  limit = 50
): Promise<{ session_id: string; messages: ChatHistoryItem[] }> {
  const res = await fetch(`${rt.baseUrl}/api/v1/history?limit=${limit}`, {
    headers: { Authorization: `Bearer ${rt.token}` }
  })
  if (!res.ok) throw new Error(`历史读取失败: HTTP ${res.status}`)
  return (await res.json()) as { session_id: string; messages: ChatHistoryItem[] }
}

/** 清空对话记录（保留会话） */
export async function clearHistory(rt: ApiRuntime): Promise<void> {
  const res = await fetch(`${rt.baseUrl}/api/v1/history`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${rt.token}` }
  })
  if (!res.ok) throw new Error(`清空失败: HTTP ${res.status}`)
}

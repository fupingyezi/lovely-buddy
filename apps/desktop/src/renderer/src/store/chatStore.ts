// 聊天状态：发送（乐观插入 + SSE 累加）、停止（abort，半截保留）、历史刷新（断线恢复）。
import { create } from 'zustand'
import { getHistory, streamChat } from '../lib/chatApi'

export interface ChatItem {
  role: 'user' | 'assistant'
  content: string
  motion?: string
}

interface ChatState {
  items: ChatItem[]
  sessionId: string | null
  /** 一次发送进行中（流式接收或请求未结束） */
  sending: boolean
  error: string | null
  /** 最近一次 motion 事件（气泡驱动模型动作），seq 单调递增防同意图去重 */
  lastMotion: { intent: string; seq: number } | null
  send(text: string, avatar?: string): Promise<void>
  stop(): void
  refresh(): Promise<void>
}

let abort: AbortController | null = null
let motionSeq = 0

export const useChatStore = create<ChatState>()((set, get) => ({
  items: [],
  sessionId: null,
  sending: false,
  error: null,
  lastMotion: null,

  async send(text, avatar) {
    const msg = text.trim()
    if (!msg || get().sending) return
    set((s) => ({
      items: [...s.items, { role: 'user', content: msg }, { role: 'assistant', content: '' }],
      sending: true,
      error: null
    }))
    abort = new AbortController()
    const updateLast = (fn: (item: ChatItem) => ChatItem): void => {
      set((s) => {
        const items = [...s.items]
        items[items.length - 1] = fn(items[items.length - 1])
        return { items }
      })
    }
    try {
      const rt = await window.lovelybuddy.getRuntime()
      await streamChat(
        rt,
        { avatar, message: msg },
        (ev) => {
          if (ev.type === 'meta') set({ sessionId: ev.session_id })
          else if (ev.type === 'delta') updateLast((it) => ({ ...it, content: it.content + ev.text }))
          else if (ev.type === 'motion') set({ lastMotion: { intent: ev.intent, seq: ++motionSeq } })
          else if (ev.type === 'done') updateLast((it) => ({ ...it, content: ev.text, motion: ev.motion || undefined }))
          else if (ev.type === 'error') set({ error: ev.error })
        },
        abort.signal
      )
    } catch (e) {
      // 用户主动停止不算错误（服务端会把半截落库，下次 refresh 对齐）
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        set({ error: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      abort = null
      set((s) => {
        const items = s.items
        const last = items[items.length - 1]
        if (last && last.role === 'assistant' && last.content === '') {
          return { items: items.slice(0, -1), sending: false } // 空占位（直连失败）移除
        }
        return { sending: false }
      })
    }
  },

  stop() {
    abort?.abort()
  },

  async refresh() {
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const h = await getHistory(rt)
      set({
        sessionId: h.session_id,
        items: h.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.motion ? { motion: m.motion } : {})
        })),
        error: null
      })
    } catch {
      // 后端离线保持现状；健康恢复后由调用方再触发
    }
  }
}))

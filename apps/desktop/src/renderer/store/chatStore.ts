// 聊天状态：发送（乐观插入 + SSE 累加）、停止（abort，半截保留）、历史刷新（断线恢复）。
import { create } from 'zustand'
import { clearHistory, getHistory, streamChat } from '@/lib/chatApi'

export interface ChatItem {
  role: 'user' | 'assistant'
  content: string
  motion?: string
  /** 消息时间（服务端历史 / 本地发送时刻），设置·对话记录分组用 */
  created_at?: string
}

interface ChatState {
  items: ChatItem[]
  sessionId: string | null
  /** 一次发送进行中（流式接收或请求未结束） */
  sending: boolean
  error: string | null
  /** 最近一次 motion 事件（气泡驱动模型动作），seq 单调递增防同意图去重 */
  lastMotion: { intent: string; seq: number } | null
  /** 会话内流式回复序号（delta/done 递增；历史 refresh/clear 不动）——气泡门控：
   *  启动/断线恢复拉历史不重放旧回复，只有本会话流出的内容才触发气泡 */
  replySeq: number
  /** 气泡立即收起序号（打开设置等场景）：气泡据此隐藏当前回复且不再重放 */
  dismissSeq: number
  /** 立即收起气泡（不等 8s 自动淡出） */
  dismissBubble(): void
  send(text: string, avatar?: string): Promise<void>
  stop(): void
  refresh(): Promise<void>
  /** 最近一次发送使用的形象 slug（retry 复用） */
  lastAvatar?: string
  /** 失败重试：去掉本地末尾失败残留的用户消息后原样重发 */
  retry(): void
  /** 清空对话记录（后端清库 + 本地重置） */
  clear(): Promise<void>
}

let abort: AbortController | null = null
let motionSeq = 0

export const useChatStore = create<ChatState>()((set, get) => ({
  items: [],
  sessionId: null,
  sending: false,
  error: null,
  lastMotion: null,
  replySeq: 0,
  dismissSeq: 0,

  dismissBubble() {
    set((s) => ({ dismissSeq: s.dismissSeq + 1 }))
  },

  async send(text, avatar) {
    const msg = text.trim()
    if (!msg || get().sending) return
    const now = new Date().toISOString()
    set((s) => ({
      ...s,
      lastAvatar: avatar,
      items: [
        ...s.items,
        { role: 'user', content: msg, created_at: now },
        { role: 'assistant', content: '', created_at: now }
      ],
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
          else if (ev.type === 'delta') {
            updateLast((it) => ({ ...it, content: it.content + ev.text }))
            if (ev.text !== '') set((s) => ({ replySeq: s.replySeq + 1 }))
          } else if (ev.type === 'motion') set({ lastMotion: { intent: ev.intent, seq: ++motionSeq } })
          else if (ev.type === 'done') {
            updateLast((it) => ({ ...it, content: ev.text, motion: ev.motion || undefined }))
            if (ev.text !== '') set((s) => ({ replySeq: s.replySeq + 1 }))
          } else if (ev.type === 'error') set({ error: ev.error })
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

  // 重试：离线/请求失败后点击错误行。常见失败=后端未收到（未落库），去掉本地残留
  // 用户消息不留重；服务端已收而客户端失败的罕见重复由断线恢复 refresh 对齐。
  retry() {
    if (get().sending) return
    const items = get().items
    let tail = items.length
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].role === 'assistant' && items[i].content !== '') break // 已有成功回复
      if (items[i].role === 'user') {
        tail = i
        break
      }
    }
    if (tail >= items.length) return
    const text = items[tail].content
    set({ items: items.slice(0, tail), error: null })
    void get().send(text, get().lastAvatar)
  },

  async clear() {
    try {
      const rt = await window.lovelybuddy.getRuntime()
      await clearHistory(rt)
      set({ items: [], error: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  async refresh() {
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const h = await getHistory(rt, 200) // 设置页承诺「仅保留最近 200 条」
      set({
        sessionId: h.session_id,
        items: h.messages.map((m) => ({
          role: m.role,
          content: m.content,
          created_at: m.created_at,
          ...(m.motion ? { motion: m.motion } : {})
        })),
        error: null
      })
    } catch {
      // 后端离线保持现状；健康恢复后由调用方再触发
    }
  }
}))

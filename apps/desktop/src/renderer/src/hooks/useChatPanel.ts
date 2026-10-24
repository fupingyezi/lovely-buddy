import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../store/chatStore'
import { BUBBLE_HOLD_MS } from '../pet/chat/bubbleTiming'

/** 聊天区向左上扩展的宽度（px）：气泡头顶左上空白 + 输入条铺满（图 01/02 比例） */
export const CHAT_W = 520
/** 聊天区在窗口上方扩展的高度（px）：输入条 64 + 错误行 24 + 上边距 8 + 行距 8 + 头顶呼吸 16 */
export const CHAT_H = 120

/**
 * 聊天面板状态机（对照 usePetMenu）：
 * - 窗口扩展条件 = 面板打开 || 正在流式回复 || 气泡展示保持期（BUBBLE_HOLD_MS）
 * - openPanel 带 递增令牌（防「点开又立刻关掉」竞态，expandWindow resolve 后不再 setOpen）
 * - Esc / 点面板外（非 data-interactive）关闭；收起统一延迟调度，气泡期不缩窗
 */
export function useChatPanel(): { open: boolean; openPanel: () => void; closePanel: () => void } {
  const [open, setOpen] = useState(false)
  const tokenRef = useRef(0)
  const expandedRef = useRef(false)
  const collapseTimerRef = useRef<number | null>(null)
  const sending = useChatStore((s) => s.sending)

  const collapse = (): void => {
    if (!expandedRef.current) return
    expandedRef.current = false
    window.lovelybuddy.collapseWindow('chat')
    window.lovelybuddy.setPassthrough(true) // 立即恢复穿透，交给 usePassthrough 状态机接管
  }

  const cancelCollapse = (): void => {
    if (collapseTimerRef.current === null) return
    window.clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = null
  }

  // 气泡可见期间保持扩展：计时从流式结束/面板关闭起算，已有待执行则不重置
  const scheduleCollapse = (): void => {
    if (collapseTimerRef.current !== null) return
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null
      collapse()
    }, BUBBLE_HOLD_MS)
  }

  const openPanel = (): void => {
    const token = ++tokenRef.current
    cancelCollapse()
    void window.lovelybuddy.expandWindow('chat', CHAT_W, CHAT_H).then(() => {
      expandedRef.current = true
      if (token !== tokenRef.current) return // 期间已关闭/重开
      setOpen(true)
    })
  }

  const closePanel = (): void => {
    tokenRef.current++
    setOpen(false)
    // 收起由下方 effect 统一调度（sending 中保持扩展，否则气泡期后缩回）
  }

  // 面板打开/流式中：保持扩展并取消收起；否则调度延迟收起
  useEffect(() => {
    if (sending || open) {
      cancelCollapse()
      return
    }
    scheduleCollapse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Element && e.target.closest('[data-interactive]')) return
      closePanel()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePanel()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 卸载取消待执行收起（测试防泄漏）
  useEffect(() => cancelCollapse, [])

  return { open, openPanel, closePanel }
}

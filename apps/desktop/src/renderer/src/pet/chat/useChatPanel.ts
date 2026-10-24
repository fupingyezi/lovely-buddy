import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../store/chatStore'

/** 聊天区在窗口上方扩展的高度（px）：输入条 64 + 错误行 24 + 上边距 8 + 行距 8 + 头顶呼吸 16 */
export const CHAT_H = 120

/**
 * 聊天面板状态机（对照 usePetMenu）：
 * - 窗口扩展条件 = 面板打开 || 正在流式回复（面板关了气泡还得有地方显示）
 * - openPanel 带 递增令牌（防「点开又立刻关掉」竞态，expandWindow resolve 后不再 setOpen）
 * - Esc / 点面板外（非 data-interactive）关闭
 */
export function useChatPanel(): { open: boolean; openPanel: () => void; closePanel: () => void } {
  const [open, setOpen] = useState(false)
  const tokenRef = useRef(0)
  const expandedRef = useRef(false)
  const sending = useChatStore((s) => s.sending)
  const sendingRef = useRef(sending)
  sendingRef.current = sending

  const collapse = (): void => {
    if (!expandedRef.current) return
    expandedRef.current = false
    window.lovelybuddy.collapseWindow('chat')
    window.lovelybuddy.setPassthrough(true) // 立即恢复穿透，交给 usePassthrough 状态机接管
  }

  const openPanel = (): void => {
    const token = ++tokenRef.current
    void window.lovelybuddy.expandWindow('chat', 0, CHAT_H).then(() => {
      expandedRef.current = true
      if (token !== tokenRef.current) return // 期间已关闭/重开
      setOpen(true)
    })
  }

  const closePanel = (): void => {
    tokenRef.current++
    setOpen(false)
    if (!sendingRef.current) collapse() // 流式中保持扩展（气泡）
  }

  // 流式结束而面板已关：自动缩回
  useEffect(() => {
    if (sending || open) return
    collapse()
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

  return { open, openPanel, closePanel }
}

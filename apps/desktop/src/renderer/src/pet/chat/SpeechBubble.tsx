import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '../../store/chatStore'
import { getActiveModel } from '../../live2d/modelBus'
import { INTENT_MOTIONS, type MotionIntent } from '../../live2d/motionMap'
import { useTypewriter } from './useTypewriter'

/** 流式结束（sending=false）后静默多久淡出 */
const HIDE_AFTER_MS = 8000

interface Props {
  /** 聊天面板打开时让位（回复显示在面板历史里），气泡隐藏 */
  panelOpen: boolean
}

/**
 * 打字机气泡：流式/最近回复悬浮在 chat 扩展区顶部。纯展示（pointer-events:none，
 * 不加 data-interactive、不参与穿透状态机——点击应穿到桌面）。
 * store 的 motion 事件在此驱动模型播动作（服务端已剥离标签，本地只按意图播放）。
 */
export default function SpeechBubble({ panelOpen }: Props): ReactElement | null {
  const items = useChatStore((s) => s.items)
  const sending = useChatStore((s) => s.sending)
  const lastMotion = useChatStore((s) => s.lastMotion)
  const [visible, setVisible] = useState(false)

  const last = items.length > 0 ? items[items.length - 1] : null
  const isReply = last !== null && last.role === 'assistant' && last.content !== ''
  const shown = useTypewriter(visible && !panelOpen && isReply ? last.content : '')

  // 回复内容变化（新流式/新消息）→ 显示；面板打开 → 隐藏；静默 8s → 隐藏
  useEffect(() => {
    if (panelOpen || !isReply) {
      setVisible(false)
      return
    }
    setVisible(true)
    if (sending) return // 流式中不计时；sending 翻 false 会重跑本 effect 起计时
    const id = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS)
    return () => window.clearTimeout(id)
  }, [panelOpen, isReply, sending, last?.content])

  // motion 事件 → 当前模型播动作（seq 去重，一次事件一个动作）
  const seqRef = useRef(0)
  useEffect(() => {
    if (lastMotion === null || lastMotion.seq === seqRef.current) return
    seqRef.current = lastMotion.seq
    if (lastMotion.intent in INTENT_MOTIONS) {
      void getActiveModel()?.playIntent(lastMotion.intent as MotionIntent)
    }
  }, [lastMotion])

  if (!visible || panelOpen || !isReply) return null
  return (
    <div className="speech-bubble" aria-live="polite">
      {shown}
    </div>
  )
}

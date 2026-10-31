import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '@/store/chatStore'
import { getActiveModel, useActiveModel } from '@/live2d/engine/modelBus'
import { INTENT_MOTIONS, type MotionIntent } from '@/live2d/motion/motionMap'
import { useWindowGeometry } from '@/live2d/window/windowGeometry'
import { useTypewriter } from '@/pet/chat/useTypewriter'
import { bubbleOffsets } from '@/pet/chat/bubbleLayout'
import { HIDE_AFTER_MS, FADE_MS } from '@/pet/chat/bubbleTiming'

interface Props {
  /** 聊天面板打开时让位（回复显示在面板历史里），气泡隐藏——互斥规则保留 */
  panelOpen: boolean
}

/**
 * 打字机气泡：尾巴尖端锚定模型头部左上角上方 16px（PetModel.anchor，按实际艺术边界）。
 * 布局在渲染期响应式推导（几何 store + 模型总线），不再自行监听 resize——
 * 监听顺序会让气泡读到"模型未位移的旧锚点 + 新窗口尺寸"，造成不可见/错位。
 * 弹出门控 replySeq：只展示本会话流式产生的回复（历史刷新不重放）；完整展示
 * 完毕（淡出完成）后记录序号，同一回复不重放。
 * 纯展示（pointer-events:none，不加 data-interactive、不参与穿透状态机——点击穿到桌面）。
 */
export default function SpeechBubble({ panelOpen }: Props): ReactElement | null {
  const items = useChatStore((s) => s.items)
  const sending = useChatStore((s) => s.sending)
  const lastMotion = useChatStore((s) => s.lastMotion)
  const replySeq = useChatStore((s) => s.replySeq)
  const pet = useActiveModel((s) => s.model)
  const dismissSeq = useChatStore((s) => s.dismissSeq)
  const { size } = useWindowGeometry()
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('gone')
  const hideTimerRef = useRef<number | null>(null)
  const outTimerRef = useRef<number | null>(null)
  const shownSeqRef = useRef(0)

  const last = items.length > 0 ? items[items.length - 1] : null
  const isReply = last !== null && last.role === 'assistant' && last.content !== ''
  const shown = useTypewriter(phase !== 'gone' && !panelOpen && isReply ? last.content : '')

  // 布局：anchor getter 实时读模型位置（windowAnchor 位移后仍准确），窗口尺寸来自几何 store
  const layout = pet ? bubbleOffsets(pet.anchor, size.w, size.h) : null

  useEffect(() => {
    if (panelOpen || !isReply) {
      setPhase('gone')
      return
    }
    // 门控：replySeq=0（纯历史）或已完整展示过 → 不弹出。
    // willShow=true 即本 run 刚弹出，直接排 8s 淡出计时（无需等下一轮 effect）；
    // willShow=false 时 shownSeqRef 只会在淡出完成（phase 已 'gone'）时写入，
    // 不存在"仍在展示却无需计时"的状态，故可安全跳过。
    const willShow = replySeq !== 0 && replySeq !== shownSeqRef.current
    if (willShow) setPhase('in')
    if (sending) return // 流式中不计时；sending 翻 false 会重跑本 effect 起计时
    if (!willShow) return
    const id = window.setTimeout(() => {
      setPhase('out')
      hideTimerRef.current = null
      outTimerRef.current = window.setTimeout(() => {
        shownSeqRef.current = replySeq // 完整展示完毕，历史刷新等不再重放
        setPhase('gone')
      }, FADE_MS)
    }, HIDE_AFTER_MS)
    hideTimerRef.current = id
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
      if (outTimerRef.current !== null) {
        window.clearTimeout(outTimerRef.current)
        outTimerRef.current = null
      }
    }
  }, [panelOpen, isReply, sending, replySeq])

  // 立即收起（打开设置等场景）：清掉两个淡出计时再把当前回复标记为已展示——
  // 计时不清会把已 gone 的 phase 拨回 out，气泡在 8s 后以淡出态复活
  useEffect(() => {
    if (dismissSeq === 0) return
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    if (outTimerRef.current !== null) {
      window.clearTimeout(outTimerRef.current)
      outTimerRef.current = null
    }
    shownSeqRef.current = useChatStore.getState().replySeq
    setPhase('gone')
  }, [dismissSeq])

  // motion 事件 → 当前模型播动作（seq 去重，一次事件一个动作）
  const seqRef = useRef(0)
  useEffect(() => {
    if (lastMotion === null || lastMotion.seq === seqRef.current) return
    seqRef.current = lastMotion.seq
    if (lastMotion.intent in INTENT_MOTIONS) {
      void getActiveModel()?.playIntent(lastMotion.intent as MotionIntent)
    }
  }, [lastMotion])

  if (phase === 'gone' || panelOpen || !isReply) return null
  const classes = [
    // pointer-events-none 必须保留：点击穿到桌面
    'speech-bubble fixed z-[80] flex flex-col items-end pointer-events-none',
    phase === 'out' ? 'speech-bubble--out' : '',
    layout === null ? 'speech-bubble--center' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const style =
    layout === null
      ? undefined
      : { right: layout.right, bottom: layout.bottom, maxWidth: layout.maxWidth, maxHeight: layout.maxHeight }
  return (
    <div className={classes} style={style} aria-live="polite">
      <div className="speech-bubble-body max-w-full overflow-y-auto px-4 py-(--sp-2) rounded-bubble bg-surface text-ink text-(--fs-body) leading-[1.6] whitespace-pre-wrap break-words shadow-mint animate-bubble-pop origin-bottom-right">
        {shown}
      </div>
      {/* right 与 bubbleLayout.TAIL_INSET 对齐 */}
      <span
        className="speech-bubble-tail absolute right-[24px] -bottom-1.5 size-3 bg-surface rounded-bl rotate-45"
        aria-hidden="true"
      />
    </div>
  )
}

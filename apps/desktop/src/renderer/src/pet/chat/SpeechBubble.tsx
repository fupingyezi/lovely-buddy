import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '../../store/chatStore'
import { getActiveModel } from '../../live2d/modelBus'
import { INTENT_MOTIONS, type MotionIntent } from '../../live2d/motionMap'
import { useTypewriter } from './useTypewriter'
import { bubbleOffsets, type BubbleOffsets } from './bubbleLayout'
import { HIDE_AFTER_MS, FADE_MS } from './bubbleTiming'

interface Props {
  /** 聊天面板打开时让位（回复显示在面板历史里），气泡隐藏——互斥规则保留 */
  panelOpen: boolean
}

/**
 * 打字机气泡：尾巴尖端锚定模型头部左上角上方 16px（PetModel.anchor），
 * 弹出 Scale 0.72→1.04→1 180ms + 同步淡入，8s 静默后淡出。
 * 纯展示（pointer-events:none，不加 data-interactive、不参与穿透状态机——点击穿到桌面）。
 */
export default function SpeechBubble({ panelOpen }: Props): ReactElement | null {
  const items = useChatStore((s) => s.items)
  const sending = useChatStore((s) => s.sending)
  const lastMotion = useChatStore((s) => s.lastMotion)
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('gone')
  const outTimerRef = useRef<number | null>(null)
  const [layout, setLayout] = useState<BubbleOffsets | null>(null)

  const last = items.length > 0 ? items[items.length - 1] : null
  const isReply = last !== null && last.role === 'assistant' && last.content !== ''
  const shown = useTypewriter(phase !== 'gone' && !panelOpen && isReply ? last.content : '')

  // 回复内容变化 → 弹出；面板打开/无回复 → 立即消失；静默 8s → 淡出 200ms → 卸载
  useEffect(() => {
    if (panelOpen || !isReply) {
      setPhase('gone')
      return
    }
    setPhase('in')
    if (sending) return // 流式中不计时；sending 翻 false 会重跑本 effect 起计时
    const id = window.setTimeout(() => {
      setPhase('out')
      outTimerRef.current = window.setTimeout(() => setPhase('gone'), FADE_MS)
    }, HIDE_AFTER_MS)
    return () => {
      window.clearTimeout(id)
      if (outTimerRef.current !== null) {
        window.clearTimeout(outTimerRef.current)
        outTimerRef.current = null
      }
    }
  }, [panelOpen, isReply, sending, last?.content])

  // 锚点定位：窗口 resize（扩展/收起）后重算；无模型回退居中样式
  useEffect(() => {
    const recalc = (): void => {
      const pet = getActiveModel()
      setLayout(pet ? bubbleOffsets(pet.anchor, window.innerWidth, window.innerHeight) : null)
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [])

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
    'speech-bubble',
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
      <div className="speech-bubble-body">{shown}</div>
      <span className="speech-bubble-tail" aria-hidden="true" />
    </div>
  )
}

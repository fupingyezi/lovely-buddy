// 意图 → 动作组候选（模型间命名不统一，按优先级依次尝试，忽略大小写）。
export type MotionIntent =
  | 'idle'
  | 'tap'
  | 'greet'
  | 'thinking'
  | 'speak'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'bye'
  | 'sleep'

export const INTENT_MOTIONS: Record<MotionIntent, string[]> = {
  idle: ['idle', 'Idle_1', 'idle_1', 'standby', 'breath', 'taunt'],
  tap: ['tap', 'tap_body', 'TapBody', 'dote_tap', 'poke', 'Poke', 'touch'],
  greet: ['greet', 'Greet', 'hello', 'Hello', 'shake', 'wave'],
  thinking: ['think', 'Think', 'thinking', 'Thinking', 'ponder'],
  speak: ['speak', 'talk', 'Talk', 'mouth_open', 'shout'],
  happy: ['happy', 'Happy', 'joy', 'Joy', 'excited', 'Excited', 'cheer', 'Cheer'],
  sad: ['sad', 'Sad', 'cry', 'Cry', 'depress', 'Depress'],
  angry: ['angry', 'Angry', 'mad', 'Mad', 'annoyed', 'Annoyed'],
  surprised: ['surprised', 'Surprised', 'surprise', 'Surprise', 'shock', 'Shock'],
  bye: ['bye', 'Bye', 'goodbye', 'Goodbye', 'wave', 'Wave'],
  sleep: ['sleep', 'Sleep', 'nap', 'Nap', 'rest', 'Rest']
}

/** 从模型实际拥有的动作组里挑一个能表达意图的；无匹配时回退 idle 组。 */
export function pickMotion(intent: MotionIntent, groups: string[]): string | null {
  const candidates = INTENT_MOTIONS[intent] ?? []
  for (const c of candidates) {
    const exact = groups.find((g) => g === c)
    if (exact) return exact
  }
  const lower = groups.map((g) => g.toLowerCase())
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase())
    if (idx >= 0) return groups[idx]
  }
  if (intent === 'idle') return null
  return pickMotion('idle', groups)
}

export interface ParsedMotionTags {
  /** 文本中最后一个可识别的 [motion:xxx] 意图（无则为 null） */
  motion: MotionIntent | null
  /** 剥离全部 motion 标签后的干净文本 */
  cleaned: string
}

/** 解析回复文本中的 [motion:xxx] 标签（M2 聊天接入使用）。 */
export function parseMotionTags(text: string): ParsedMotionTags {
  let motion: MotionIntent | null = null
  const cleaned = text
    .replace(/\[motion:([a-zA-Z_]+)\]/g, (_m, name: string) => {
      const intent = name.toLowerCase() as MotionIntent
      if (intent in INTENT_MOTIONS) motion = intent
      return ''
    })
    .trim()
  return { motion, cleaned }
}

// 意图 → 具体动作/表情的解析（五层降级）：
// ① avatar.json 手工映射（引用的组/表情必须真实存在，否则整条失效）
// ② 内置动作组（INTENT_MOTIONS 候选）+ 表情名规则，组合播放
// ③ 只播匹配表情（无动作可播的模型至少"变个脸"）
// ④ 通用反应动作：优先 Tap 组，否则第一个非 idle 组
// ⑤ idle 组兜底
// greet/idle 跳过 ③④：问候与待机保持动作语义。
import { INTENT_MOTIONS, type MotionIntent } from '@/live2d/motion/motionMap'
import { type ResolvedAction } from '@/live2d/motion/motionScheduler'
import { type ModelCapabilities } from '@/live2d/engine/capabilities'

export interface AvatarActionSpec {
  /** 动作组名（模型内不存在时整条映射失效） */
  motion?: string
  /** 组内动作下标（缺省 = 库随机） */
  motionIndex?: number
  /** 表情名（模型内不存在时整条映射失效） */
  expression?: string
}

export type AvatarActions = Partial<Record<MotionIntent, AvatarActionSpec>>

// 表情名意图规则：按小写子串匹配，取模型表情序第一个命中。
// 每个意图的词表刻意避开其他意图的高频词，减少误命中；shizuku 的 f01
// 这类编号表情匹配不到任何规则 → 走通用动作降级，属于预期。
const EXPRESSION_RULES: Record<MotionIntent, string[]> = {
  idle: [],
  tap: [],
  greet: [],
  thinking: ['think', 'ponder', 'confus', 'puzzle', 'doubt'],
  speak: ['talk', 'speak', 'shout', 'laugh', 'smile'],
  happy: ['fun', 'happy', 'smile', 'joy', 'laugh', 'grin', 'delight', 'excite', 'cheer'],
  sad: ['sad', 'cry', 'depress', 'gloom', 'sorrow', 'despair'],
  angry: ['anger', 'angry', 'mad', 'annoy', 'pout', 'upset'],
  surprised: ['surpris', 'shock', 'amaze', 'astonish', 'wow'],
  bye: [],
  sleep: ['sleep', 'nap', 'drows', 'yawn', 'closeeye', 'close_eye']
}

export function resolveAction(
  intent: MotionIntent,
  caps: ModelCapabilities,
  actions?: AvatarActions
): ResolvedAction | null {
  const mapped = resolveMapped(intent, caps, actions)
  if (mapped) return mapped
  const group = pickGroup(intent, caps)
  if (group) return { group, index: undefined, expression: pickExpression(intent, caps) }
  if (intent !== 'greet' && intent !== 'idle') {
    const expr = pickExpression(intent, caps)
    if (expr) return { group: null, index: undefined, expression: expr }
    const generic = pickGeneric(caps)
    if (generic) return { group: generic, index: undefined, expression: null }
  }
  const idle = pickGroup('idle', caps)
  return idle ? { group: idle, index: undefined, expression: null } : null
}

/** ① avatar.json 手工映射；引用的组/表情不存在、下标越界或空映射视为「写给别的模型」，整条失效 */
function resolveMapped(intent: MotionIntent, caps: ModelCapabilities, actions?: AvatarActions): ResolvedAction | null {
  const spec = actions?.[intent]
  if (!spec) return null
  if (spec.motion === undefined && spec.expression === undefined) return null
  if (spec.motion !== undefined && !Object.prototype.hasOwnProperty.call(caps.motions, spec.motion)) return null
  if (spec.motionIndex !== undefined) {
    if (spec.motion === undefined) return null
    if (spec.motionIndex < 0 || spec.motionIndex >= caps.motions[spec.motion]) return null
  }
  if (spec.expression !== undefined && !caps.expressions.includes(spec.expression)) return null
  return { group: spec.motion ?? null, index: spec.motionIndex, expression: spec.expression ?? null }
}

/** 内置动作组匹配：INTENT_MOTIONS 候选依次精确/忽略大小写匹配，无匹配返回 null */
function pickGroup(intent: MotionIntent, caps: ModelCapabilities): string | null {
  const candidates = INTENT_MOTIONS[intent] ?? []
  const groups = Object.keys(caps.motions)
  for (const c of candidates) {
    if (groups.includes(c)) return c
  }
  const lower = groups.map((g) => g.toLowerCase())
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase())
    if (idx >= 0) return groups[idx]
  }
  return null
}

/** ④ 通用反应动作：优先 Tap 组；否则第一个非 idle 组（确定性，便于测试） */
function pickGeneric(caps: ModelCapabilities): string | null {
  const tap = pickGroup('tap', caps)
  if (tap) return tap
  const idleLower = INTENT_MOTIONS.idle.map((n) => n.toLowerCase())
  return Object.keys(caps.motions).find((g) => !idleLower.includes(g.toLowerCase())) ?? null
}

/** 表情名规则匹配：取模型表情序第一个命中规则词的表情 */
function pickExpression(intent: MotionIntent, caps: ModelCapabilities): string | null {
  const words = EXPRESSION_RULES[intent] ?? []
  if (words.length === 0) return null
  for (const name of caps.expressions) {
    const low = name.toLowerCase()
    if (words.some((w) => low.includes(w))) return name
  }
  return null
}

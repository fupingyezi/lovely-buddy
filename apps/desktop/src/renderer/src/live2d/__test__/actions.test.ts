import { describe, expect, it } from 'vitest'
import { resolveAction, type AvatarActions } from '../actions'
import { type ModelCapabilities } from '../capabilities'

// 三套与真实模型同构的夹具：haru（官方免费，只有 Idle/Tap + 单词表情）、
// shizuku（cubism2，tap_body/shake + 编号表情）、katou 类（语义化表情 F_*）
const haru: ModelCapabilities = {
  motions: { Idle: 3, Tap: 5 },
  expressions: ['Angry', 'Happy', 'Surprised']
}
const shizuku: ModelCapabilities = {
  motions: { idle: 2, tap_body: 4, shake: 1 },
  expressions: ['f01', 'f02', 'smile']
}
const katou: ModelCapabilities = {
  motions: { Idle: 2, Tap: 23, talk: 3 },
  expressions: ['F_FUN', 'F_SAD', 'F_ANGRY', 'F_SURPRISE', 'F_SLEEPY']
}

describe('resolveAction', () => {
  it('haru：tap 命中 Tap 组；happy 无组按表情规则命中 Happy（纯表情）', () => {
    expect(resolveAction('tap', haru)).toEqual({ group: 'Tap', index: undefined, expression: null })
    expect(resolveAction('happy', haru)).toEqual({ group: null, index: undefined, expression: 'Happy' })
  })

  it('haru：sad 无组无表情规则 → 通用 Tap 兜底', () => {
    expect(resolveAction('sad', haru)).toEqual({ group: 'Tap', index: undefined, expression: null })
  })

  it('shizuku：tap 命中 tap_body；smile 按规则命中 happy；sad 走通用动作', () => {
    expect(resolveAction('tap', shizuku)).toEqual({ group: 'tap_body', index: undefined, expression: null })
    expect(resolveAction('happy', shizuku)).toEqual({ group: null, index: undefined, expression: 'smile' })
    expect(resolveAction('sad', shizuku)).toEqual({ group: 'tap_body', index: undefined, expression: null })
  })

  it('katou：语义化表情逐个命中；thinking 无组无表情 → 通用 Tap', () => {
    expect(resolveAction('happy', katou)).toEqual({ group: null, index: undefined, expression: 'F_FUN' })
    expect(resolveAction('sad', katou)).toEqual({ group: null, index: undefined, expression: 'F_SAD' })
    expect(resolveAction('angry', katou)).toEqual({ group: null, index: undefined, expression: 'F_ANGRY' })
    expect(resolveAction('surprised', katou)).toEqual({ group: null, index: undefined, expression: 'F_SURPRISE' })
    expect(resolveAction('thinking', katou)).toEqual({ group: 'Tap', index: undefined, expression: null })
  })

  it('avatar.json 映射优先：motion+index+expression 组合', () => {
    const actions: AvatarActions = { happy: { motion: 'Tap', motionIndex: 4, expression: 'F_FUN' } }
    expect(resolveAction('happy', katou, actions)).toEqual({ group: 'Tap', index: 4, expression: 'F_FUN' })
  })

  it('映射只配 expression → 纯表情', () => {
    const actions: AvatarActions = { sad: { expression: 'F_SAD' } }
    expect(resolveAction('sad', katou, actions)).toEqual({ group: null, index: undefined, expression: 'F_SAD' })
  })

  it('映射指向不存在的动作组 → 整条失效走内置降级', () => {
    const actions: AvatarActions = { happy: { motion: 'Nope', expression: 'F_FUN' } }
    expect(resolveAction('happy', katou, actions)).toEqual({ group: null, index: undefined, expression: 'F_FUN' })
  })

  it('映射指向不存在的表情 → 整条失效走内置降级', () => {
    const actions: AvatarActions = { happy: { motion: 'Tap', expression: 'NOPE' } }
    expect(resolveAction('happy', katou, actions)).toEqual({ group: null, index: undefined, expression: 'F_FUN' })
  })

  it('greet 无专属组不降级到表情/通用动作，idle 兜底（与旧行为一致）', () => {
    expect(resolveAction('greet', haru)).toEqual({ group: 'Idle', index: undefined, expression: null })
  })

  it('idle 意图：有 idle 组命中；无任何 idle 组返回 null', () => {
    expect(resolveAction('idle', haru)).toEqual({ group: 'Idle', index: undefined, expression: null })
    expect(resolveAction('idle', { motions: { Tap: 3 }, expressions: [] })).toBeNull()
  })

  it('语义组命中时附带表情（组合播放）', () => {
    const caps: ModelCapabilities = { motions: { talk: 3 }, expressions: ['F_SMILE'] }
    expect(resolveAction('speak', caps)).toEqual({ group: 'talk', index: undefined, expression: 'F_SMILE' })
  })
})

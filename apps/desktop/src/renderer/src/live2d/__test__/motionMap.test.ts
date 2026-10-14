import { describe, expect, it } from 'vitest'
import { INTENT_MOTIONS, parseMotionTags, pickMotion, type MotionIntent } from '../motionMap'

describe('pickMotion', () => {
  it('按候选顺序精确匹配动作组', () => {
    const groups = ['Idle_1', 'tap_body', 'think', 'idle']
    expect(pickMotion('idle', groups)).toBe('idle') // 候选第 1 位 Idle_1 不精确命中，落到 idle
    expect(pickMotion('tap', groups)).toBe('tap_body')
    expect(pickMotion('thinking', groups)).toBe('think')
  })

  it('精确匹配优先于忽略大小写匹配', () => {
    const groups = ['Happy', 'happy']
    expect(pickMotion('happy', groups)).toBe('happy')
  })

  it('意图无匹配时回退 idle 组', () => {
    const groups = ['idle', 'think']
    expect(pickMotion('sad', groups)).toBe('idle')
  })

  it('无 idle 组时返回 null', () => {
    expect(pickMotion('sad', ['think'])).toBeNull()
    expect(pickMotion('idle', [])).toBeNull()
  })

  it('所有意图都配置了候选', () => {
    for (const intent of Object.keys(INTENT_MOTIONS) as MotionIntent[]) {
      expect(INTENT_MOTIONS[intent].length).toBeGreaterThan(0)
    }
  })
})

describe('parseMotionTags', () => {
  it('无标签返回原文本', () => {
    expect(parseMotionTags('你好呀')).toEqual({ motion: null, cleaned: '你好呀' })
  })

  it('解析单个标签并剥离', () => {
    expect(parseMotionTags('哈哈[motion:happy]')).toEqual({ motion: 'happy', cleaned: '哈哈' })
  })

  it('多个标签取最后一个可识别的', () => {
    const r = parseMotionTags('[motion:thinking]让我想想[motion:surprised]')
    expect(r.motion).toBe('surprised')
    expect(r.cleaned).toBe('让我想想')
  })

  it('未知标签忽略且不残留', () => {
    const r = parseMotionTags('你好[motion:unknown_tag]呀')
    expect(r.motion).toBeNull()
    expect(r.cleaned).toBe('你好呀')
  })

  it('剥离后首尾空白被清理', () => {
    const r = parseMotionTags('  [motion:bye]再见 ')
    expect(r).toEqual({ motion: 'bye', cleaned: '再见' })
  })
})

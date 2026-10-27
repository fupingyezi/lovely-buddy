import { describe, expect, it } from 'vitest'
import { parseMotionTags } from '../motionMap'

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

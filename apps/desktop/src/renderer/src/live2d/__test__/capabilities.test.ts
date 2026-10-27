import { describe, expect, it } from 'vitest'
import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch'
import { deriveCapabilities } from '../capabilities'

function fakeModel(settings: object, definitions: Record<string, unknown[]>): Live2DModel {
  return { internalModel: { motionManager: { definitions }, settings } } as unknown as Live2DModel
}

describe('deriveCapabilities', () => {
  it('汇总动作组数与表情名（cubism4 大写 Name）', () => {
    const caps = deriveCapabilities(
      fakeModel({ expressions: [{ Name: 'F_FUN' }, { Name: 'F_SAD' }] }, { Idle: [1, 2, 3], Tap: [1] })
    )
    expect(caps).toEqual({ motions: { Idle: 3, Tap: 1 }, expressions: ['F_FUN', 'F_SAD'] })
  })

  it('cubism2 小写 name 同样可读', () => {
    const caps = deriveCapabilities(fakeModel({ expressions: [{ name: 'f01' }, { name: 'f02' }] }, {}))
    expect(caps.expressions).toEqual(['f01', 'f02'])
  })

  it('无表情字段 → 空数组', () => {
    expect(deriveCapabilities(fakeModel({}, { Idle: [1] }))).toEqual({ motions: { Idle: 1 }, expressions: [] })
  })
})

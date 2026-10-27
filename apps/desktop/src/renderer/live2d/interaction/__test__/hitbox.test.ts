import { describe, expect, it } from 'vitest'
import { hitAnyDrawable } from '@/live2d/interaction/hitbox'

/** 模拟 internalModel：两个部件包围盒（模型画布坐标） */
function boundsOf(i: number): { x: number; y: number; width: number; height: number } {
  if (i === 0) return { x: 100, y: 300, width: 300, height: 400 } // 身体
  return { x: 150, y: 100, width: 200, height: 150 } // 头
}

describe('hitAnyDrawable（无 HitAreas 模型的可视碰撞箱兜底）', () => {
  it('点在部件内 → true', () => {
    expect(hitAnyDrawable(boundsOf, 2, 250, 500)).toBe(true) // 身体中部
    expect(hitAnyDrawable(boundsOf, 2, 250, 150)).toBe(true) // 头部
    expect(hitAnyDrawable(boundsOf, 2, 100, 300)).toBe(true) // 身体左上角（边界）
  })

  it('点在所有部件外 → false', () => {
    expect(hitAnyDrawable(boundsOf, 2, 0, 0)).toBe(false)
    expect(hitAnyDrawable(boundsOf, 2, 99, 299)).toBe(false) // 身体左上角 1px 外
    expect(hitAnyDrawable(boundsOf, 2, 500, 500)).toBe(false) // 身体右边界 1px 外
    expect(hitAnyDrawable(boundsOf, 2, 250, 280)).toBe(false) // 头与身体之间的空隙
  })

  it('部件数为 0 → 恒 false（退化模型不误吞点击）', () => {
    expect(hitAnyDrawable(boundsOf, 0, 250, 500)).toBe(false)
  })
})

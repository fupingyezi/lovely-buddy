import { describe, expect, it } from 'vitest'
import { MENU_H, MENU_W, planMenuPlacement } from '../menuLayout'

describe('planMenuPlacement', () => {
  it('小窗口（haru 164px）：横向扩到装下菜单，纵向扩 332 让菜单紧贴角色头顶上方', () => {
    expect(planMenuPlacement(164)).toEqual({ x: 4, y: 4, extraW: 120, extraH: 332 })
    expect(MENU_W).toBe(280)
    expect(MENU_H).toBe(320)
  })

  it('窗口已比菜单宽：不再横向扩展', () => {
    expect(planMenuPlacement(400).extraW).toBe(0)
  })

  it('扩展后菜单完整落在窗口内', () => {
    const { x, extraW } = planMenuPlacement(164)
    expect(x + MENU_W).toBeLessThanOrEqual(164 + extraW)
  })

  it('扩展后菜单底边距角色顶 ≥ 8px（角色顶=局部 y=extraH）', () => {
    const { extraH } = planMenuPlacement(164)
    expect(4 + MENU_H + 8).toBeLessThanOrEqual(extraH)
  })
})

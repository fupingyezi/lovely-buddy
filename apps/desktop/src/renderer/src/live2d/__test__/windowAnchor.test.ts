import { describe, expect, it } from 'vitest'
import { shiftToKeepScreenPosition } from '../windowAnchor'

// haru 模型窗口 164×227；菜单展开向左上扩 (120, 532)
describe('shiftToKeepScreenPosition', () => {
  it('窗口向左上扩展：位置补上尺寸增量，屏幕位置不变', () => {
    const pos = shiftToKeepScreenPosition({ x: 82, y: 219 }, { w: 164, h: 227 }, { w: 284, h: 759 })
    expect(pos).toEqual({ x: 202, y: 751 })
  })

  it('收起（负增量）与扩展互为逆操作：往返后位置复原', () => {
    const prev = { w: 164, h: 227 }
    const next = { w: 284, h: 759 }
    const expanded = shiftToKeepScreenPosition({ x: 82, y: 219 }, prev, next)
    expect(shiftToKeepScreenPosition(expanded, next, prev)).toEqual({ x: 82, y: 219 })
  })

  it('尺寸不变时位置不变', () => {
    const pos = shiftToKeepScreenPosition({ x: 82, y: 219 }, { w: 164, h: 227 }, { w: 164, h: 227 })
    expect(pos).toEqual({ x: 82, y: 219 })
  })
})

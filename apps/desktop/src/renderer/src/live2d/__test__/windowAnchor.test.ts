import { describe, expect, it } from 'vitest'
import { headAnchorOffset, shiftToKeepScreenPosition } from '../windowAnchor'

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

describe('headAnchorOffset', () => {
  // 画布 164×227、scale 1：艺术盒顶留白 40px；头部带（盒高 20% = 37.4px）内只有头发/头部件
  const boundsOf = (i: number): { x: number; y: number; width: number; height: number } =>
    i === 0
      ? { x: 60, y: 40, width: 44, height: 50 } // 头发：盒顶、头部左缘
      : { x: 30, y: 95, width: 104, height: 132 } // 身体：带外（95 > 77.4）

  it('头顶 = 实际艺术盒顶（画布留白不计），头部左缘 = 顶部带并集左缘', () => {
    const o = headAnchorOffset(boundsOf, 2, 164, 227, 1)
    expect(o).toEqual({ x: 60 - 164 / 2, y: 40 - 227 })
  })

  it('缩放比例线性作用于偏移', () => {
    const o = headAnchorOffset(boundsOf, 2, 164, 227, 2)
    expect(o).toEqual({ x: (60 - 164 / 2) * 2, y: (40 - 227) * 2 })
  })

  it('无部件时返回 null（包围盒退化）', () => {
    expect(headAnchorOffset(boundsOf, 0, 164, 227, 1)).toBeNull()
  })

  it('全零盒（cubism2 首帧 draw 前）返回 null：调用方下一帧重试', () => {
    const zeros = (): { x: number; y: number; width: number; height: number } => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
    expect(headAnchorOffset(zeros, 3, 164, 227, 1)).toBeNull()
  })
})

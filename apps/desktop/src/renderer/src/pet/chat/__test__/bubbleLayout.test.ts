import { describe, expect, it } from 'vitest'
import { BUBBLE_INSET, TAIL_GAP, TAIL_H, TAIL_INSET, bubbleOffsets } from '../bubbleLayout'

describe('bubbleOffsets', () => {
  it('尾巴尖端落在头部左上角上方 16px（元素 right/bottom 偏移换算）', () => {
    const winW = 300
    const winH = 700
    const anchor = { x: 0, y: 120 } // 头部左上角 = 模型顶（窗口坐标 y=chat 扩展量）
    const o = bubbleOffsets(anchor, winW, winH)
    const tipX = winW - o.right - TAIL_INSET
    const tipY = winH - o.bottom + TAIL_H
    expect(tipX).toBe(anchor.x)
    expect(tipY).toBe(anchor.y - TAIL_GAP)
  })

  it('菜单也展开时锚点随扩展量平移（锚点 x>0 仍正确）', () => {
    const o = bubbleOffsets({ x: 120, y: 452 }, 300, 700)
    expect(300 - o.right - TAIL_INSET).toBe(120)
    expect(700 - o.bottom + TAIL_H).toBe(452 - TAIL_GAP)
  })

  it('maxWidth/maxHeight 夹在窗口与头部上方空间内', () => {
    const o = bubbleOffsets({ x: 40, y: 200 }, 300, 700)
    expect(o.maxWidth).toBe(40 + TAIL_INSET - BUBBLE_INSET)
    expect(o.maxHeight).toBe(200 - TAIL_GAP - TAIL_H - BUBBLE_INSET)
  })

  it('窗口极小也保持非负', () => {
    const o = bubbleOffsets({ x: 0, y: 60 }, 100, 200)
    expect(o.maxWidth).toBeGreaterThanOrEqual(0)
    expect(o.maxHeight).toBeGreaterThanOrEqual(0)
  })
})

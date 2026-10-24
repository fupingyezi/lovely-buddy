import type { Pos } from '../../live2d/windowAnchor'

/** 尾巴尖端距头部左上角的呼吸距离（图 01） */
export const TAIL_GAP = 16
/** 尾巴伸出气泡底缘的高度 */
export const TAIL_H = 8
/** 尾巴距气泡右缘的距离 */
export const TAIL_INSET = 24
/** 气泡与窗口边的内边距 */
export const BUBBLE_INSET = 8

export interface BubbleOffsets {
  right: number
  bottom: number
  maxWidth: number
  maxHeight: number
}

/**
 * 气泡右下锚定换算：尾巴尖端落在 (anchor.x, anchor.y - 16)（头部左上角上方 16px）。
 * 元素 right/bottom 偏移 = 窗口尺寸 − 锚点坐标 ± 尾巴几何；maxWidth/maxHeight 把气泡
 * 夹在窗口与头部上方空间（扩展区）内，负值回 0。
 */
export function bubbleOffsets(anchor: Pos, winW: number, winH: number): BubbleOffsets {
  return {
    right: winW - anchor.x - TAIL_INSET,
    bottom: winH - anchor.y + TAIL_GAP + TAIL_H,
    maxWidth: Math.max(anchor.x + TAIL_INSET - BUBBLE_INSET, 0),
    maxHeight: Math.max(anchor.y - TAIL_GAP - TAIL_H - BUBBLE_INSET, 0)
  }
}

export interface Pos {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

/**
 * 窗口尺寸变化时保持元素屏幕位置不变的换算：
 * 窗口右/下边固定、只动左/上边时，窗口坐标增量 = 尺寸增量，
 * 元素位置补上同量增量即保持屏幕位置不动（展开为正增量、收起为负增量）。
 */
export function shiftToKeepScreenPosition(pos: Pos, prev: Size, next: Size): Pos {
  return { x: pos.x + (next.w - prev.w), y: pos.y + (next.h - prev.h) }
}

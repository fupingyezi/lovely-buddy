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

/** 模型包围盒左上角（窗口坐标）：模型锚点 (0.5,1) 站在 (centerX, footY)，显示尺寸 w×h。 */
export function modelTopLeft(centerX: number, footY: number, w: number, h: number): Pos {
  return { x: centerX - w / 2, y: footY - h }
}

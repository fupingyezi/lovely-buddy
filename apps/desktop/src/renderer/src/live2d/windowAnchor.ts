export interface Pos {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

/** 绘制部件包围盒（模型画布坐标，与 hitbox 同约定：x/y/width/height） */
export interface DrawableBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 窗口尺寸变化时保持元素屏幕位置不变的换算：
 * 窗口右/下边固定、只动左/上边时，窗口坐标增量 = 尺寸增量，
 * 元素位置补上同量增量即保持屏幕位置不动（展开为正增量、收起为负增量）。
 */
export function shiftToKeepScreenPosition(pos: Pos, prev: Size, next: Size): Pos {
  return { x: pos.x + (next.w - prev.w), y: pos.y + (next.h - prev.h) }
}

/** 头部区域判定：艺术包围盒顶部 20% 带（顶部部件通常是头发/帽子，覆盖头部宽度） */
const HEAD_BAND = 0.2

/**
 * 头部左上角相对模型位置（脚底中点）的偏移（窗口坐标）。
 * 画布盒顶 ≠ 头顶：画布常有留白，尾巴锚画布顶会飘在人物上方；按默认姿态
 * 绘制部件求实际艺术包围盒——头顶 = 盒顶；头部左缘 = 与盒顶 HEAD_BAND 带
 * 相交部件的并集左缘。模型位置 = 画布底部中心，画布点 (mx,my) → 位置偏移
 * ((mx - canvasW/2)·scale, (my - canvasH)·scale)。
 * canvasW/canvasH 必须是缩放前的画布像素尺寸（PIXI 的 width/height 会随
 * scale 变化，事后读会双重缩放；boundsOf 的空间与之一致）。
 * 包围盒退化（cubism2 首帧 draw 前 getTransformedPoints 矩阵未初始化、全零盒）
 * 返回 null：调用方推迟到下一帧重试。
 */
export function headAnchorOffset(
  boundsOf: (index: number) => DrawableBox,
  count: number,
  canvasW: number,
  canvasH: number,
  scale: number
): Pos | null {
  if (count === 0) return null
  const art = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (let i = 0; i < count; i++) {
    const b = boundsOf(i)
    const right = b.x + b.width
    const bottom = b.y + b.height
    if (b.x < art.left) art.left = b.x
    if (b.y < art.top) art.top = b.y
    if (right > art.right) art.right = right
    if (bottom > art.bottom) art.bottom = bottom
  }
  // 全零盒无面积（cubism2 首帧前）：不是有效艺术边界
  if (art.left > art.right || art.top > art.bottom) return null
  const bandBottom = art.top + (art.bottom - art.top) * HEAD_BAND
  const head = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (let i = 0; i < count; i++) {
    const b = boundsOf(i)
    // 盒顶部件必然与带相交：并集非空
    if (b.y < bandBottom && b.y + b.height > art.top) {
      if (b.x < head.left) head.left = b.x
      if (b.y < head.top) head.top = b.y
      if (b.x + b.width > head.right) head.right = b.x + b.width
      if (b.y + b.height > head.bottom) head.bottom = b.y + b.height
    }
  }
  // 带内无部件（理论不发生，防御零高盒）：视为无效
  if (head.left > head.right || head.top > head.bottom) return null
  return { x: (head.left - canvasW / 2) * scale, y: (art.top - canvasH) * scale }
}

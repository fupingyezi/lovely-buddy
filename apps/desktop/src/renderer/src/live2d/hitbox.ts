/**
 * 无 HitAreas 模型（如官方 haru，model3.json 未定义 HitAreas）的可视碰撞箱兜底：
 * 逐绘制部件取当前顶点包围盒，判断点（模型画布坐标）是否落在任一部件内。
 * 与 fork 内置 hitTest（只认模型自带 HitAreas）互补，纯函数便于单测。
 */
export function hitAnyDrawable(
  boundsOf: (index: number) => { x: number; y: number; width: number; height: number },
  count: number,
  x: number,
  y: number
): boolean {
  for (let i = 0; i < count; i++) {
    const b = boundsOf(i)
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return true
  }
  return false
}

// 窗口 bounds 纯数学：普通矩形进出，不 import electron，可在 node 环境单测。
// Electron 胶水（windowManager）只负责取屏幕/调窗口 API，锚定与夹紧规则全部收口在这。

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

// 无模型时的占位窗口尺寸（创建窗口/默认位置用）
export const WIN_W = 420
export const WIN_H = 480
// 模型窗口的最小地板（防退化模型算出 0 尺寸），正常模型远大于此
export const MIN_W = 60
export const MIN_H = 90

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/** 已保存的窗口位置若在当前屏幕内可用则恢复，否则回默认（贴底部居中）。 */
export function initialBounds(saved: Point | null, workArea: Rect): Point {
  const inScreen =
    saved !== null &&
    saved.x >= workArea.x - WIN_W / 2 &&
    saved.x <= workArea.x + workArea.width - WIN_W / 2 &&
    saved.y >= workArea.y - 64 &&
    saved.y <= workArea.y + workArea.height - 64
  return inScreen
    ? { x: saved.x, y: saved.y }
    : {
        x: Math.round(workArea.x + (workArea.width - WIN_W) / 2),
        y: Math.round(workArea.y + workArea.height - WIN_H)
      }
}

/** 增量拖动后按工作区夹紧，窗口始终完整可见。 */
export function moveBounds(
  pos: Point,
  size: { width: number; height: number },
  dx: number,
  dy: number,
  workArea: Rect
): Point {
  return {
    x: clamp(pos.x + Math.round(dx), workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(pos.y + Math.round(dy), workArea.y, workArea.y + workArea.height - size.height)
  }
}

/** 模型加载后的窗口尺寸：底部中点锚定（脚不跳），尺寸夹在 [MIN, 工作区] 内。 */
export function modelResizeBounds(current: Rect, width: number, height: number, workArea: Rect): Rect {
  const w = clamp(Math.round(width), MIN_W, workArea.width)
  const h = clamp(Math.round(height), MIN_H, workArea.height)
  return {
    x: Math.round(current.x + current.width / 2 - w / 2),
    y: Math.round(current.y + current.height - h),
    width: w,
    height: h
  }
}

/** 菜单展开：向左上扩 extraWidth×extraHeight，右下角固定（角色屏幕位置不动），左/上按工作区夹紧。 */
export function expandBounds(current: Rect, extraWidth: number, extraHeight: number, workArea: Rect): Rect {
  const x = Math.max(workArea.x, current.x - extraWidth)
  const y = Math.max(workArea.y, current.y - extraHeight)
  return { x, y, width: current.width + (current.x - x), height: current.height + (current.y - y) }
}

/** 菜单展开的扩展量（主进程权威，杜绝渲染进程 stale innerWidth 竞态——连续
 *  Cmd+点击时渲染进程的 resize 事件落后于主进程 setBounds，读窗口尺寸会算错）：
 *  - 宽：按当前窗口真实宽度补足 requiredW（菜单右贴窗口，宽度不足向左扩）。
 *  - 高：绝对 requiredH——菜单打开期间头顶空间恒定（≥requiredH），其他面板
 *    中途收起（如气泡保持期结束）菜单仍贴头顶不压角色。 */
export function menuExpandExtras(
  current: Rect,
  requiredW: number,
  requiredH: number
): { width: number; height: number } {
  return {
    width: Math.max(0, requiredW - current.width),
    height: requiredH
  }
}

/** 菜单收起：缩回基准尺寸，右下角固定 → 一定回到展开前的屏幕区域。 */
export function collapseBounds(current: Rect, base: Rect): Rect {
  return {
    x: current.x + (current.width - base.width),
    y: current.y + (current.height - base.height),
    width: base.width,
    height: base.height
  }
}

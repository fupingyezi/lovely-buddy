// 菜单尺寸：CSS 固定 260×320（高为固定值，与 .pet-menu 精确对齐；
// 宽按上限留余量）。菜单太高会飘到离角色很远的地方，固定高度让它紧贴头顶。
export const MENU_W = 280
export const MENU_H = 320

// 菜单贴窗口的内边距
export const MENU_INSET = 4
// 菜单底边与角色头顶的最小间距
const CHAR_GAP = 8

/** 菜单+内边距的窗口绝对需求（扩展量由主进程按真实 bounds 计算，见 window/bounds） */
export const MENU_REQUIRED_W = MENU_W + MENU_INSET * 2
export const MENU_REQUIRED_H = MENU_H + MENU_INSET + CHAR_GAP

/**
 * 菜单窗口坐标 top：右贴窗口（right=MENU_INSET），底边距头顶 CHAR_GAP。
 * 头顶窗口坐标 headTop = 窗高 − 模型基准窗高（几何 store 响应式推导）；
 * 窗口被屏幕夹紧导致头顶空间不足时贴窗口顶（菜单压到角色，已知取舍）。
 */
export function menuTop(headTop: number): number {
  return Math.max(MENU_INSET, headTop - CHAR_GAP - MENU_H)
}

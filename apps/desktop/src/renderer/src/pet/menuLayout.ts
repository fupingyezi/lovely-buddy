// 菜单尺寸：CSS 固定 260×320（高为固定值，与 .pet-menu 精确对齐；
// 宽按上限留余量）。菜单太高会飘到离角色很远的地方，固定高度让它紧贴头顶。
export const MENU_W = 280
export const MENU_H = 320

// 菜单贴窗口左上角的内边距
const MENU_INSET = 4
// 菜单底边与角色头顶的最小间距
const CHAR_GAP = 8

export interface MenuLayout {
  x: number
  y: number
  extraW: number
  extraH: number
}

/**
 * 菜单固定放窗口左上 (4,4)，返回窗口需向左上扩展的量：
 * - 宽：窗口要装下菜单右缘（4 + MENU_W），不足则向左扩。
 * - 高：角色顶在窗口局部 y=0（窗口严格贴合模型），向上扩展 extraH 后角色顶移到
 *   局部 y=extraH（模型 resize 位移见 live2d/windowAnchor，屏幕位置不动）；
 *   要求菜单底（4 + MENU_H）距角色顶 ≥ CHAR_GAP。
 * 主进程按屏幕工作区夹紧实际扩展量（贴屏幕边缘时菜单可能压到角色，已知取舍）。
 */
export function planMenuPlacement(winW: number): MenuLayout {
  return {
    x: MENU_INSET,
    y: MENU_INSET,
    extraW: Math.max(0, MENU_W + MENU_INSET - winW),
    extraH: MENU_H + MENU_INSET + CHAR_GAP
  }
}

// 菜单尺寸：高度随形象数自适应——单一事实来源 menuHeight(n)，
// usePetMenu（扩展量）与 PetMenu（渲染高度/menuTop）都引用它，避免固定高度
// 与渲染内容脱节（旧版 320 固定高度，底部留白会拦截鼠标）。
export const MENU_W = 260

// 菜单贴窗口的内边距
export const MENU_INSET = 4
// 菜单底边与角色头顶的最小间距
const CHAR_GAP = 8

// 内部排版常量（与 PetMenu JSX 的 padding/gap/h-* 精确一致）
export const MENU_PAD = 10 // 菜单四周内边距
export const STATUS_H = 16 // 状态行
export const DIVIDER_H = 1 // 分隔线
export const ROW_H = 40 // 形象行
export const ROW_GAP = 2 // 形象行间距
export const ACTIONS_H = 34 // 底部按钮行
export const SECTION_GAP = 8 // 区段间距（flex gap-2）
export const MAX_LIST_ROWS = 4 // 列表最多可见行数，超出内部滚动

/** 形象列表实际渲染高度（>4 个按 4 行封顶，列表区内部滚动） */
export function listHeight(modelCount: number): number {
  const rows = Math.min(Math.max(modelCount, 0), MAX_LIST_ROWS)
  return rows === 0 ? 0 : rows * ROW_H + (rows - 1) * ROW_GAP
}

/**
 * 菜单总高度：单形象 87（紧凑态，无列表区：10+16+8+1+8+34+10）；
 * 多形象 = 紧凑态 + 列表区 + 两条区段间隙（3 个形象 = 228）。
 */
export function menuHeight(modelCount: number): number {
  if (modelCount <= 1) {
    return MENU_PAD * 2 + STATUS_H + SECTION_GAP * 2 + DIVIDER_H + ACTIONS_H // 87
  }
  return MENU_PAD * 2 + STATUS_H + SECTION_GAP * 4 + DIVIDER_H * 2 + ACTIONS_H + listHeight(modelCount)
}

/** 菜单+内边距的窗口宽度需求（扩展量由主进程按真实 bounds 计算，见 window/bounds） */
export const MENU_REQUIRED_W = MENU_W + MENU_INSET * 2

/** 菜单+内边距+距头顶间隙的窗口绝对高度需求 */
export function menuRequiredHeight(modelCount: number): number {
  return menuHeight(modelCount) + MENU_INSET + CHAR_GAP
}

/**
 * 菜单窗口坐标 top：右贴窗口（right=MENU_INSET），底边距头顶 CHAR_GAP。
 * 头顶窗口坐标 headTop = 窗高 − 模型基准窗高（几何 store 响应式推导）；
 * 窗口被屏幕夹紧导致头顶空间不足时贴窗口顶（菜单压到角色，已知取舍）。
 */
export function menuTop(headTop: number, modelCount: number): number {
  return Math.max(MENU_INSET, headTop - CHAR_GAP - menuHeight(modelCount))
}

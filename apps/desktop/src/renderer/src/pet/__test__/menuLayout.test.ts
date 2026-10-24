import { describe, expect, it } from 'vitest'
import {
  listHeight,
  MAX_LIST_ROWS,
  MENU_INSET,
  MENU_REQUIRED_W,
  MENU_W,
  menuHeight,
  menuRequiredHeight,
  menuTop
} from '../menuLayout'

describe('menuLayout 自适应高度（单一事实来源）', () => {
  it('单形象紧凑态 87：内边距+状态行+一条分隔线+按钮行', () => {
    expect(menuHeight(1)).toBe(87)
    expect(menuHeight(0)).toBe(87)
  })

  it('多形象加列表区：3 个 = 228（设计注「约 222」，以自洽算术为准）', () => {
    expect(listHeight(3)).toBe(124) // 3×40 + 2×2
    expect(menuHeight(3)).toBe(228)
    expect(menuHeight(2)).toBe(186) // 104 + 82
  })

  it('超过 4 行封顶并内部滚动', () => {
    expect(menuHeight(4)).toBe(270) // 104 + 166（listHeight 公式自洽为准，计划原注 266 系笔误）
    expect(menuHeight(5)).toBe(menuHeight(MAX_LIST_ROWS))
  })

  it('需求宽含左右内边距，需求高含顶边距与距头顶 8px', () => {
    expect(MENU_W).toBe(260)
    expect(MENU_INSET).toBe(4)
    expect(MENU_REQUIRED_W).toBe(268)
    expect(menuRequiredHeight(3)).toBe(240) // 228 + 4 + 8
    expect(menuRequiredHeight(1)).toBe(99)
  })
})

describe('menuTop：菜单底边距头顶 8px、右贴窗口', () => {
  it('无其他扩展（头顶 240）：贴窗口顶', () => {
    expect(menuTop(240, 3)).toBe(4)
  })

  it('聊天扩展在身（头顶 452）：下移到头顶上方（底边距头顶 8px）', () => {
    expect(menuTop(452, 3)).toBe(452 - 8 - 228)
  })

  it('头顶空间不足：贴窗口顶（窗口被屏幕夹紧的已知取舍）', () => {
    expect(menuTop(100, 3)).toBe(4)
  })

  it('紧凑态高度参与 top 计算', () => {
    expect(menuTop(452, 1)).toBe(452 - 8 - 87)
  })
})

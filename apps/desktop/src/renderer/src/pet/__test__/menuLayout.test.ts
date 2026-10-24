import { describe, expect, it } from 'vitest'
import { MENU_H, MENU_INSET, MENU_REQUIRED_H, MENU_REQUIRED_W, MENU_W, menuTop } from '../menuLayout'

describe('menuLayout 需求常量', () => {
  it('菜单 280×320，内边距 4，需求宽含左右内边距、需求高含顶边距与距头顶 8px', () => {
    expect(MENU_W).toBe(280)
    expect(MENU_H).toBe(320)
    expect(MENU_INSET).toBe(4)
    expect(MENU_REQUIRED_W).toBe(288)
    expect(MENU_REQUIRED_H).toBe(332)
  })
})

describe('menuTop：菜单底边距头顶 8px、右贴窗口', () => {
  it('无其他扩展（头顶 332）：贴窗口顶', () => {
    expect(menuTop(332)).toBe(4)
  })

  it('聊天扩展在身（头顶 452）：下移到头顶上方（底边距头顶 8px）', () => {
    expect(menuTop(452)).toBe(124)
  })

  it('头顶空间不足：贴窗口顶（窗口被屏幕夹紧的已知取舍）', () => {
    expect(menuTop(100)).toBe(4)
  })
})

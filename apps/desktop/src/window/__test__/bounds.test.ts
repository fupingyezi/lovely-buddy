// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  MIN_H,
  MIN_W,
  WIN_H,
  WIN_W,
  collapseBounds,
  expandBounds,
  initialBounds,
  menuExpandExtras,
  modelResizeBounds,
  moveBounds
} from '../bounds'

// 常见工作区：1920x1080、原点 (0,0)
const WA = { x: 0, y: 0, width: 1920, height: 1080 }

describe('initialBounds：已保存位置的恢复校验', () => {
  it('无保存位置 → 贴底部居中默认', () => {
    expect(initialBounds(null, WA)).toEqual({ x: Math.round((1920 - WIN_W) / 2), y: 1080 - WIN_H })
  })

  it('屏幕内保存位置 → 原样恢复', () => {
    expect(initialBounds({ x: 100, y: 200 }, WA)).toEqual({ x: 100, y: 200 })
  })

  it('屏幕外保存位置 → 回默认', () => {
    expect(initialBounds({ x: -5000, y: 200 }, WA).x).toBe(Math.round((1920 - WIN_W) / 2))
    expect(initialBounds({ x: 100, y: 5000 }, WA).y).toBe(1080 - WIN_H)
  })

  it('恰好在容差边界（x=-WIN_W/2, y=-64）→ 仍视为可用', () => {
    expect(initialBounds({ x: -WIN_W / 2, y: -64 }, WA)).toEqual({ x: -WIN_W / 2, y: -64 })
  })
})

describe('moveBounds：增量拖动夹紧', () => {
  const size = { width: 200, height: 300 }

  it('普通增量移动', () => {
    expect(moveBounds({ x: 100, y: 100 }, size, 50, 25, WA)).toEqual({ x: 150, y: 125 })
  })

  it('向左/上移出屏幕 → 夹到工作区左/上缘', () => {
    expect(moveBounds({ x: 100, y: 100 }, size, -1000, -1000, WA)).toEqual({ x: 0, y: 0 })
  })

  it('向右移出屏幕 → 窗口右缘贴工作区右缘（完整可见）', () => {
    expect(moveBounds({ x: 100, y: 100 }, size, 5000, 0, WA).x).toBe(1920 - 200)
  })
})

describe('modelResizeBounds：模型加载后的窗口尺寸', () => {
  const cur = { x: 100, y: 200, width: 200, height: 300 }

  it('底部中点锚定（脚不跳）', () => {
    expect(modelResizeBounds(cur, 300, 360, WA)).toEqual({ x: 50, y: 140, width: 300, height: 360 })
  })

  it('退化模型 → 夹到最小地板', () => {
    expect(modelResizeBounds(cur, 10, 10, WA)).toEqual({ x: 170, y: 410, width: MIN_W, height: MIN_H })
  })

  it('超过工作区 → 夹到工作区尺寸', () => {
    expect(modelResizeBounds(cur, 5000, 5000, WA)).toMatchObject({ width: 1920, height: 1080 })
  })
})

describe('expandBounds：菜单展开（右下角锚定）', () => {
  const cur = { x: 100, y: 200, width: 200, height: 300 }

  it('无遮挡 → 向左上扩 extra，右下角不动', () => {
    expect(expandBounds(cur, 50, 80, WA)).toEqual({ x: 50, y: 120, width: 250, height: 380 })
  })

  it('屏幕左缘遮挡 → x 夹到 0，宽度只增长剩余量', () => {
    expect(expandBounds({ ...cur, x: 10 }, 100, 0, WA)).toEqual({ x: 0, y: 200, width: 210, height: 300 })
  })

  it('屏幕上缘遮挡 → y 夹到 0，高度只增长剩余量', () => {
    expect(expandBounds({ ...cur, y: 30 }, 0, 100, WA)).toEqual({ x: 100, y: 0, width: 200, height: 330 })
  })
})

describe('menuExpandExtras：菜单展开扩展量（主进程权威）', () => {
  it('窄窗口补足宽（菜单右贴窗完整可见），高给满', () => {
    expect(menuExpandExtras({ x: 0, y: 0, width: 164, height: 227 }, 288, 332)).toEqual({ width: 124, height: 332 })
  })

  it('宽窗口不再横向扩展', () => {
    expect(menuExpandExtras({ x: 0, y: 0, width: 400, height: 227 }, 288, 332)).toEqual({ width: 0, height: 332 })
  })

  it('高度永远是绝对需求值（其他面板中途收起时头顶空间不缩水，菜单不压角色）', () => {
    expect(menuExpandExtras({ x: 0, y: 0, width: 820, height: 700 }, 288, 332).height).toBe(332)
  })
})

describe('collapseBounds + expandBounds 往返：缩回必回原位', () => {
  it('无遮挡：expand → collapse 回到原 bounds', () => {
    const base = { x: 100, y: 200, width: 200, height: 300 }
    expect(collapseBounds(expandBounds(base, 50, 80, WA), base)).toEqual(base)
  })

  it('屏幕边缘被夹紧：expand → collapse 仍回到原 bounds', () => {
    const base = { x: 5, y: 10, width: 200, height: 300 }
    expect(collapseBounds(expandBounds(base, 100, 50, WA), base)).toEqual(base)
  })
})

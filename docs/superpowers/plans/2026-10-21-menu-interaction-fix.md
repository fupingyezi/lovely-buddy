# 菜单交互修复（瞬移 / 遮挡 / 无关闭按钮）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复右键菜单的三个交互缺陷：Cmd+点击弹菜单时角色瞬移、菜单遮挡角色导致点不了、菜单没有关闭按钮。

**Architecture:** 根因有三：(1) 展开窗口只移动窗口左/上边，角色窗口坐标固定不动 → 屏幕位置跟着窗口漂移，需在 window resize 时给模型位置补尺寸增量（屏幕位稳）；(2) 菜单放在点击处（角色身上）→ 改为固定放窗口左上、向上扩展窗口，扩展后菜单落在角色头顶上方 8px 以上，永不遮挡；(3) PetMenu 补 ✕ 关闭按钮。interact.ts 无需改动——tap 判定已用 screenX/screenY（屏幕坐标），菜单开着时点角色 tap 与关菜单同时正常触发。

**Tech Stack:** Electron + React 18 + zustand + PIXI v8（pixi-live2d-display-lipsyncpatch 0.5.0-ls-8）+ vitest 5 + @testing-library/react 16 + jsdom。

**Spec:** 无独立 spec（修复型改动）。设计决策与根因见下方「背景与设计」，逐条对应任务。

## 背景与设计（执行者必读）

三个症状的根因（已在会话中定位，勿再调查）：

1. **瞬移**：`usePetMenu.openMenu` 让主进程把窗口向左上扩展（右/下边固定、左/上边外移）。`apps/desktop/src/main/index.ts` 的 `lovelybuddy:expand-window` 只动 `x/y/width/height`；渲染侧模型位置是加载时一次性 `model.position.set(innerWidth/2, innerHeight-8)`（`live2d/model.ts:77`），窗口尺寸变化后模型窗口坐标不变 → 屏幕位置随窗口左/上边漂移。haru 窗口 164×227，点击后扩展约 (120, 532) → 角色瞬移到屏幕右上象限，与用户报告一致。
   **设计**：window resize 时模型位置加尺寸增量 `(Δw, Δh)`——展开时正增量、收起时负增量，屏幕位置严格不动（收起=反向展开，往返精确复原）。监听器挂在 `addChild` 之后（初始/切模型的 resize 发生在 addChild 前，不受影响），`destroy()` 时移除。

2. **遮挡**：菜单 280×520（CSS 实为 260×480），放在点击处=角色身上 → 盖住角色，点角色全点在 data-interactive 面板上。
   **设计**：菜单固定放窗口局部 (4,4)；向上扩展 `extraH = MENU_H + 12` 后，角色顶（原局部 y=0）移到局部 y=extraH，菜单底（4+MENU_H=524）距角色顶 ≥8px（菜单实高 ≤480，实际间距 ≥48px），永不遮挡。横向 `extraW = max(0, MENU_W + 4 - winW)` 保证菜单完整落在窗口内。菜单 x 恒为 4（角色窗口宽 < 菜单宽，贴左对齐最稳定）。
   已知取舍：角色贴屏幕顶部时主进程夹紧实际扩展量，菜单可能压到角色——✕/Esc/点空白仍可关，不改。

3. **无关闭按钮**：关闭只靠「点菜单外 / Esc / 再 Cmd+点击」，不可发现。**设计**：菜单右上角加 ✕（样式仿 `.placeholder-close`）。

4. **点角色**：菜单不遮挡后，开着菜单点角色 = 捕获监听器 closeMenu（窗口收起）+ interact 的 screenX/screenY 判定照常触发 tap——两件事都成立，无需改 interact.ts。拖拽同理（screen 坐标增量不漂移）。Task 5 联调确认即可。

## Global Constraints

- 提交直接进 main（当前快速开发阶段，不走分支/PR）。
- commitlint conventional：`type(scope): subject`，subject 小写开头（中文主题无此限制）；本计划 scope 统一 `desktop`。
- 重启 `make dev` 前先跑 `memory_pressure` 查内存压力（系统内存吃紧会 SIGTERM 整个 dev 进程组，是既有已知问题）。
- 渲染进程注释用中文（跟随现有风格）。
- 测试命令：单文件 `cd apps/desktop && pnpm vitest run <file>`；前端全量 `cd apps/desktop && pnpm test`；全仓 `make test`（含 go vet/test 与 typecheck）。

---

### Task 1: 模型在窗口 resize 时保持屏幕位置（瞬移根修）

**Files:**
- Create: `apps/desktop/src/renderer/src/live2d/windowAnchor.ts`
- Test: `apps/desktop/src/renderer/src/live2d/__test__/windowAnchor.test.ts`
- Modify: `apps/desktop/src/renderer/src/live2d/model.ts`（addChild 之后挂监听器；`facade.destroy` 中移除）

**Interfaces:**
- Consumes: 无（纯函数）。
- Produces: `shiftToKeepScreenPosition(pos: {x: number; y: number}, prev: {w: number; h: number}, next: {w: number; h: number}): {x: number; y: number}` — 窗口右/下边固定时，元素位置补上尺寸增量即保持屏幕位置。Task 3 的菜单展开依赖 model.ts 对它的接线。

- [ ] **Step 1: 写失败测试**

Create `apps/desktop/src/renderer/src/live2d/__test__/windowAnchor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { shiftToKeepScreenPosition } from '../windowAnchor'

// haru 模型窗口 164×227；菜单展开向左上扩 (120, 532)
describe('shiftToKeepScreenPosition', () => {
  it('窗口向左上扩展：位置补上尺寸增量，屏幕位置不变', () => {
    const pos = shiftToKeepScreenPosition({ x: 82, y: 219 }, { w: 164, h: 227 }, { w: 284, h: 759 })
    expect(pos).toEqual({ x: 202, y: 751 })
  })

  it('收起（负增量）与扩展互为逆操作：往返后位置复原', () => {
    const prev = { w: 164, h: 227 }
    const next = { w: 284, h: 759 }
    const expanded = shiftToKeepScreenPosition({ x: 82, y: 219 }, prev, next)
    expect(shiftToKeepScreenPosition(expanded, next, prev)).toEqual({ x: 82, y: 219 })
  })

  it('尺寸不变时位置不变', () => {
    const pos = shiftToKeepScreenPosition({ x: 82, y: 219 }, { w: 164, h: 227 }, { w: 164, h: 227 })
    expect(pos).toEqual({ x: 82, y: 219 })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/windowAnchor.test.ts`
Expected: FAIL — `Failed to resolve import "../windowAnchor"`（模块不存在）。

- [ ] **Step 3: 最小实现**

Create `apps/desktop/src/renderer/src/live2d/windowAnchor.ts`:

```ts
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
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/windowAnchor.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: 接入 model.ts**

Modify `apps/desktop/src/renderer/src/live2d/model.ts`：

顶部 import 区加：

```ts
import { shiftToKeepScreenPosition } from './windowAnchor'
```

在 `app.stage.addChild(model)`（现第 78 行）之后、`// 绘制部件总数…` 注释之前插入：

```ts
  // 窗口 resize（菜单展开/收起）时保持模型屏幕位置：展开/收起只移动窗口左/上边
  // （右/下边固定），窗口坐标增量 = 尺寸增量，把增量补回模型位置即可抵消。
  // 初始/切换模型的 resize 发生在 addChild 之前，这里从当前尺寸起算，不受影响。
  let lastWinW = window.innerWidth
  let lastWinH = window.innerHeight
  const onWinResize = (): void => {
    const next = shiftToKeepScreenPosition(
      { x: model.position.x, y: model.position.y },
      { w: lastWinW, h: lastWinH },
      { w: window.innerWidth, h: window.innerHeight }
    )
    lastWinW = window.innerWidth
    lastWinH = window.innerHeight
    model.position.set(next.x, next.y)
  }
  window.addEventListener('resize', onWinResize)
```

在 `facade.destroy()` 的 `window.clearTimeout(idleTimer)` 之后加一行：

```ts
      window.removeEventListener('resize', onWinResize)
```

- [ ] **Step 6: 全量验证**

Run: `cd apps/desktop && pnpm typecheck && pnpm test`
Expected: typecheck 无错；全部测试通过（新增 3 个）。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/renderer/src/live2d/windowAnchor.ts apps/desktop/src/renderer/src/live2d/__test__/windowAnchor.test.ts apps/desktop/src/renderer/src/live2d/model.ts
git commit -m "fix(desktop): 窗口 resize 时模型保持屏幕位置（展开菜单不再瞬移）"
```

---

### Task 2: 菜单布局纯函数 menuLayout

**Files:**
- Create: `apps/desktop/src/renderer/src/pet/menuLayout.ts`
- Test: `apps/desktop/src/renderer/src/pet/__test__/menuLayout.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，不依赖窗口对象）。
- Produces: `MENU_W = 280`、`MENU_H = 520`（Task 3 沿用）；`planMenuPlacement(winW: number): MenuLayout`，`MenuLayout = { x: number; y: number; extraW: number; extraH: number }`——x/y 恒为 (4,4)；`extraW = max(0, MENU_W + 4 - winW)`；`extraH = MENU_H + 12`。

- [ ] **Step 1: 写失败测试**

Create `apps/desktop/src/renderer/src/pet/__test__/menuLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MENU_H, MENU_W, planMenuPlacement } from '../menuLayout'

describe('planMenuPlacement', () => {
  it('小窗口（haru 164px）：横向扩到装下菜单，纵向扩 532 让菜单落在角色头顶上方', () => {
    expect(planMenuPlacement(164)).toEqual({ x: 4, y: 4, extraW: 120, extraH: 532 })
    expect(MENU_W).toBe(280)
    expect(MENU_H).toBe(520)
  })

  it('窗口已比菜单宽：不再横向扩展', () => {
    expect(planMenuPlacement(400).extraW).toBe(0)
  })

  it('扩展后菜单完整落在窗口内', () => {
    const { x, extraW } = planMenuPlacement(164)
    expect(x + MENU_W).toBeLessThanOrEqual(164 + extraW)
  })

  it('扩展后菜单底边距角色顶 ≥ 8px（角色顶=局部 y=extraH）', () => {
    const { extraH } = planMenuPlacement(164)
    expect(4 + MENU_H + 8).toBeLessThanOrEqual(extraH)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/__test__/menuLayout.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 最小实现**

Create `apps/desktop/src/renderer/src/pet/menuLayout.ts`:

```ts
// 菜单尺寸上限估算（CSS 实为 260×480，按上限留余量，扩展量宁大勿小）
export const MENU_W = 280
export const MENU_H = 520

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
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/__test__/menuLayout.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/pet/menuLayout.ts apps/desktop/src/renderer/src/pet/__test__/menuLayout.test.ts
git commit -m "feat(desktop): 菜单布局纯函数（固定窗口左上、向上扩展不遮挡角色）"
```

---

### Task 3: usePetMenu 改用新布局（openMenu 不再依赖点击坐标）

**Files:**
- Test: `apps/desktop/src/renderer/src/pet/__test__/usePetMenu.test.ts`（重写）
- Modify: `apps/desktop/src/renderer/src/pet/usePetMenu.ts`（openMenu 重写；closeMenu 与 effect 不变）
- Modify: `apps/desktop/src/renderer/src/App.tsx`（onMenu 回调不再传参）

**Interfaces:**
- Consumes: `planMenuPlacement`、`MENU_W`、`MENU_H`（Task 2）。
- Produces: `usePetMenu(): { menu: MenuPos | null; openMenu: () => void; closeMenu: () => void }` — openMenu 签名去掉 (clientX, clientY)（菜单位置与点击处无关）。`MenuPos = { x: number; y: number }` 不变。

- [ ] **Step 1: 重写测试（先失败）**

用以下内容**整体替换** `apps/desktop/src/renderer/src/pet/__test__/usePetMenu.test.ts`：

```ts
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePetMenu } from '../usePetMenu'
import { MENU_H, MENU_W } from '../menuLayout'

const expandWindow = vi.fn()
const collapseWindow = vi.fn()
const setPassthrough = vi.fn()

function mockLovelybuddy(): void {
  expandWindow.mockReset().mockResolvedValue({ width: 1024, height: 1024 })
  collapseWindow.mockReset()
  setPassthrough.mockReset()
  vi.stubGlobal('lovelybuddy', { expandWindow, collapseWindow, setPassthrough })
}

/** 重设 jsdom 窗口尺寸（默认 1024x768） */
function setWindowSize(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
}

describe('usePetMenu', () => {
  beforeEach(() => {
    setWindowSize(164, 227) // haru 模型窗口
    mockLovelybuddy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('openMenu 按布局扩展窗口，完成后菜单放 (4,4)', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())

    expect(expandWindow).toHaveBeenCalledWith(MENU_W + 4 - 164, MENU_H + 12)
    await waitFor(() => expect(result.current.menu).toEqual({ x: 4, y: 4 }))
  })

  it('宽窗口只向上扩展', async () => {
    setWindowSize(400, 227)
    mockLovelybuddy()
    const { result } = renderHook(() => usePetMenu())

    act(() => result.current.openMenu())
    expect(expandWindow).toHaveBeenCalledWith(0, MENU_H + 12)
    await waitFor(() => expect(result.current.menu).toEqual({ x: 4, y: 4 }))
  })

  it('closeMenu 缩回窗口并恢复穿透', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    act(() => result.current.closeMenu())
    expect(result.current.menu).toBeNull()
    expect(collapseWindow).toHaveBeenCalledTimes(1)
    expect(setPassthrough).toHaveBeenCalledWith(true)
  })

  it('点菜单外（data-interactive 之外）关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    fireEvent.pointerDown(document.body)
    expect(result.current.menu).toBeNull()
  })

  it('点 data-interactive 内不关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    const panel = document.createElement('div')
    panel.setAttribute('data-interactive', '')
    document.body.appendChild(panel)
    fireEvent.pointerDown(panel)
    expect(result.current.menu).not.toBeNull()
    panel.remove()
  })

  it('Esc 关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => result.current.openMenu())
    await waitFor(() => expect(result.current.menu).not.toBeNull())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.menu).toBeNull()
  })

  it('点开又立刻关掉：扩展结果返回后菜单保持关闭（令牌失效）', async () => {
    let resolveExpand!: (size: { width: number; height: number }) => void
    expandWindow.mockImplementation(
      () =>
        new Promise<{ width: number; height: number }>((resolve) => {
          resolveExpand = resolve
        })
    )
    const { result } = renderHook(() => usePetMenu())

    act(() => result.current.openMenu())
    act(() => result.current.closeMenu())
    await act(async () => {
      resolveExpand({ width: 400, height: 800 })
      await Promise.resolve()
    })

    expect(result.current.menu).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/__test__/usePetMenu.test.ts`
Expected: FAIL — `result.current.openMenu(...)` 期望 0 参数但旧实现收 2 个；扩展量断言与旧行为不符。

- [ ] **Step 3: 改 usePetMenu.ts**

用以下内容**整体替换** `apps/desktop/src/renderer/src/pet/usePetMenu.ts`：

```ts
import { useEffect, useRef, useState } from 'react'
import { planMenuPlacement } from './menuLayout'

export interface MenuPos {
  x: number
  y: number
}

/**
 * 右键菜单状态机：
 * - openMenu：菜单固定放窗口左上（角色正上方），按 menuLayout 向左上扩展窗口；
 *   模型在 resize 时补尺寸增量（live2d/windowAnchor），屏幕位置不动。
 *   递增令牌让「点开又立刻关掉」的竞态失效（expandWindow resolve 后不再 setMenu）。
 * - closeMenu：缩回窗口、恢复穿透（交给 usePassthrough 状态机接管）。
 * - 菜单打开期间：点菜单外（含模型本体——tap 由 interact 的屏幕坐标判定正常触发）
 *   或 Esc 关闭。
 */
export function usePetMenu(): {
  menu: MenuPos | null
  openMenu: () => void
  closeMenu: () => void
} {
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const tokenRef = useRef(0)

  const openMenu = (): void => {
    const token = ++tokenRef.current
    const { x, y, extraW, extraH } = planMenuPlacement(window.innerWidth)
    void window.lovelybuddy.expandWindow(extraW, extraH).then(() => {
      if (token !== tokenRef.current) return // 期间已关闭/重开
      setMenu({ x, y })
    })
  }

  const closeMenu = (): void => {
    tokenRef.current++ // 使未完成的 openMenu 失效
    setMenu(null)
    window.lovelybuddy.collapseWindow()
    window.lovelybuddy.setPassthrough(true) // 立即恢复穿透，交给 usePassthrough 状态机接管
  }

  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Element && e.target.closest('[data-interactive]')) return
      closeMenu()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu])

  return { menu, openMenu, closeMenu }
}
```

- [ ] **Step 4: 改 App.tsx 的 onMenu 回调**

Modify `apps/desktop/src/renderer/src/App.tsx`（现第 50-53 行）：

```tsx
        onMenu={(x, y) => {
          if (menu) closeMenu()
          else void openMenu(x, y)
        }}
```

改为：

```tsx
        onMenu={() => {
          if (menu) closeMenu()
          else openMenu()
        }}
```

（PetCanvas 的 onMenu prop 类型不变——零参函数可赋给带参签名，interact 传入的坐标被忽略。）

- [ ] **Step 5: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/__test__/usePetMenu.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 6: 全量验证**

Run: `cd apps/desktop && pnpm typecheck && pnpm test`
Expected: typecheck 无错；全部测试通过。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/renderer/src/pet/usePetMenu.ts apps/desktop/src/renderer/src/pet/__test__/usePetMenu.test.ts apps/desktop/src/renderer/src/App.tsx
git commit -m "fix(desktop): 菜单固定放窗口左上并向上扩展（不再压在角色身上）"
```

---

### Task 4: PetMenu 增加 ✕ 关闭按钮

**Files:**
- Test: `apps/desktop/src/renderer/src/pet/__test__/PetMenu.test.tsx`（加一个用例）
- Modify: `apps/desktop/src/renderer/src/pet/PetMenu.tsx`（菜单顶部加 ✕ 按钮）
- Modify: `apps/desktop/src/renderer/src/styles/index.css`（新增 `.menu-close`；`.menu-status` 加 `padding-right` 让位）

**Interfaces:**
- Consumes: 无新增（用现有 `onClose` prop）。
- Produces: 无（纯 UI）。✕ 按钮在 `.pet-menu[data-interactive]` 内，点它不会触发 usePetMenu 的「点菜单外关闭」，直接走 `onClose`。

- [ ] **Step 1: 写失败测试**

在 `apps/desktop/src/renderer/src/pet/__test__/PetMenu.test.tsx` 的 `describe('PetMenu')` 内、「状态行显示在线状态与版本」用例之前插入：

```tsx
  it('✕ 按钮关闭菜单', () => {
    const onClose = renderMenu()
    fireEvent.click(screen.getByTitle('关闭菜单'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/__test__/PetMenu.test.tsx`
Expected: FAIL — `getByTitle('关闭菜单')` 找不到元素（`Unable to find an element with the title: 关闭菜单`）。

- [ ] **Step 3: PetMenu.tsx 加按钮**

Modify `apps/desktop/src/renderer/src/pet/PetMenu.tsx`，在 `.pet-menu` div（现第 37-42 行）内、`.menu-status` 之前插入：

```tsx
    >
      <button
        type="button"
        className="menu-close"
        title="关闭菜单"
        aria-label="关闭菜单"
        onClick={onClose}
      >
        ×
      </button>
      <div className="menu-status">
```

（即把现有的 `>\n      <div className="menu-status">` 替换为上段。）

- [ ] **Step 4: 加 CSS**

Modify `apps/desktop/src/renderer/src/styles/index.css`：

在 `.pet-menu` 规则块（现第 30-47 行）之后插入：

```css
/* ✕ 关闭按钮（绝对定位在菜单右上角） */
.menu-close {
  position: absolute;
  top: 6px;
  right: 8px;
  border: none;
  background: transparent;
  color: #999;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.menu-close:hover {
  color: #fff;
}
```

`.menu-status` 规则（现第 49-56 行）加一行，给 ✕ 让位：

```css
.menu-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 24px; /* 给右上角 ✕ 让位 */
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  cursor: default;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/__test__/PetMenu.test.tsx`
Expected: PASS（6 tests，含新增用例；其余 5 个不受影响）。

- [ ] **Step 6: 全量验证**

Run: `cd apps/desktop && pnpm typecheck && pnpm test`
Expected: typecheck 无错；全部测试通过。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/renderer/src/pet/PetMenu.tsx apps/desktop/src/renderer/src/styles/index.css apps/desktop/src/renderer/src/pet/__test__/PetMenu.test.tsx
git commit -m "feat(desktop): 菜单增加 ✕ 关闭按钮"
```

---

### Task 5: 联调验收（手动，无代码变更）

**Files:** 无。

**Interfaces:** 无。

- [ ] **Step 1: 检查内存压力后重启 dev**

```bash
memory_pressure        # 紧张则先关掉重负载进程再继续
make dev
```

（系统内存吃紧会 SIGTERM 整个 dev 进程组——重启前必查，见 Global Constraints。）

- [ ] **Step 2: 逐项验收**

| # | 操作 | 预期 |
|---|------|------|
| 1 | Cmd+点击角色 | 菜单出现在角色头顶上方（窗口左上角），**角色原地纹丝不动** |
| 2 | 观察菜单与角色 | 菜单不遮挡角色，角色完整可见 |
| 3 | 菜单开着时单击角色 | 角色播 tap 动作 + 菜单关闭，全程无位移 |
| 4 | 菜单开着时拖拽角色 | 菜单关闭、拖拽跟手，无跳跃（screen 坐标增量不受收起影响） |
| 5 | 点 ✕ 按钮 | 菜单关闭 |
| 6 | Esc | 菜单关闭 |
| 7 | 点菜单外空白处 | 菜单关闭 |
| 8 | 再次 Cmd+点击角色 | 菜单关闭（App 的 toggle） |
| 9 | 连续开合菜单 3 次 | 窗口尺寸/位置每次精确复原，角色不漂移 |
| 10 | 回归：菜单里切形象 / 导入 / 删除 | 流程正常，菜单按原逻辑关闭 |
| 11 | （可选）角色贴屏幕顶部再开菜单 | 菜单可能压到角色（已知取舍），✕/Esc 仍可关闭 |

- [ ] **Step 3: 失败处理**

任一项不符合预期：停止验收，用 systematic-debugging 定位（现象 → 根因 → 最小修复），更新本计划后继续；不凭感觉加补丁。

---

## Self-Review

**覆盖检查**（对照用户三个抱怨）：瞬移 → Task 1（模型 resize 位稳）+ Task 5#1 验收；菜单遮角色点不了 → Task 2/3（菜单放头顶上方）+ Task 5#2/3/4 验收；无关闭选项 → Task 4（✕ 按钮）+ Task 5#5-8 验收。interact.ts 无需改动（tap/拖拽已用 screenX/screenY，见「背景与设计」第 4 点），Task 5#3/4 验证该论断。

**类型一致性**：`shiftToKeepScreenPosition` 的 `Pos`/`Size` 在 Task 1 内部自洽；`planMenuPlacement`/`MenuLayout`/`MENU_W`/`MENU_H` 在 Task 2 定义、Task 3 消费，签名一致；`usePetMenu.openMenu` 改零参后，App.tsx 与测试同步改（Task 3 覆盖两个调用点）。

**风险点**：主进程 `lovelybuddy:expand-window` 已有按屏幕工作区夹紧并返回实际尺寸，Task 3 不再消费返回尺寸（菜单坐标固定 (4,4)）——贴屏幕左上角时菜单可能被窗口右缘裁掉，属已知取舍，与旧行为同级，不新增回归。

---

## 实施偏差记录（联调验收后）

验收发现两个计划外问题，已修复并回归（2026-10-22）：

1. **穿透状态卡死（根因，计划未预见）**：菜单打开触发 usePassthrough effect 重跑——cleanup 无条件把主进程穿透置回 `true`，新 effect 本地 `passthroughOn` 初值 `false`，立即同步 `setPassthrough(false)` 被去重（`false !== false`）跳过，纠正 IPC 从未发出。窗口从此卡在穿透态：mousemove 仍被 forward 转发，但点击全部穿给桌面，菜单无法关闭。**修复**：菜单状态切换的立即同步不再走去重，无条件发 IPC 并同步本地状态（`usePassthrough.ts`），补状态机单测 `usePassthrough.test.ts`（4 例）。
2. **菜单离角色太远（计划偏差）**：原设计 MENU_H=520 使菜单落在角色上方约 500px 处，用户感知为「菜单出现在之前瞬移的位置」。**改为**：CSS 固定 `height: 320px`，MENU_H 精确对齐 320，窗口只向上扩 332px，菜单底边距角色头顶 8px。`menuLayout.test.ts` 数字同步更新。

验收结果（用户确认）：菜单紧贴人物头顶上方、按钮/✕/点菜单外全部可点、人物原地不动。

排查用的临时诊断（Go debug-log 端点、lib/dbg.ts、usePassthrough/usePetMenu 插桩）已全部移除。

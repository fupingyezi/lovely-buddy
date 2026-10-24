# 气泡与菜单渲染生命周期修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复四个渲染生命周期缺陷：启动时气泡覆盖角色、发送后气泡不显示、Cmd+点击时菜单与气泡错位到屏幕右上象限、连续 Cmd+点击菜单被截断。

**Architecture:** 引入两个单一事实来源消除竞态——① `live2d/windowGeometry.ts`（zustand）：窗口尺寸与模型基准尺寸，气泡/菜单的定位全部在渲染期响应式推导，不再各自监听 resize（各监听器执行顺序会读到「模型未位移的旧锚点 + 新窗口尺寸」）；② 主进程权威的菜单展开（`expand-menu` IPC 按真实 bounds 算扩展量，杜绝渲染进程 `innerWidth` 落后于 resize 事件的 stale 读数）。气泡弹出门控改用 `chatStore.replySeq`（只随流式 delta/done 递增），启动/断线恢复拉历史不再重放旧回复；菜单改为右贴窗口、底边距头顶 8px，随几何 store 响应式贴住角色。

**Tech Stack:** Electron 主进程 + React 18 + zustand + vitest；改动全部在 `apps/desktop`（前端），Go 后端不动。

**Spec:** 用户报障（本文件「诊断」节）+ `docs/design.md` + `docs/design-v1/README.md`（气泡互斥铁律：`pointer-events:none`、输入条与气泡互斥、ChatPanel 只留输入）。

## 诊断：四个症状 → 根因

| 症状 | 根因（全部已在代码中确认） |
|---|---|
| 1. 启动时整个气泡覆盖人物 | `App.tsx` 启动即 `refresh()` 拉历史 → `SpeechBubble` 见「最后一条 assistant 非空」即弹（phase 'in'）。此时模型未加载：布局 effect 在挂载时 `getActiveModel()` 为 null 且 deps `[]` 永不重跑 → `layout` 永久为 null → 走 `speech-bubble--center` 居中回退样式，气泡无约束铺在窗口上盖住角色 |
| 2. 发送后气泡不显示 | 两个叠加原因：① `ChatPanel` 发完不自动收起，面板互斥抑制气泡（预期：对话框消失、气泡显示）；② 即便手动关面板，`SpeechBubble` 的 resize 监听器**注册早于**模型位移监听器（`model.ts` 的 `onWinResize`），resize 事件里气泡先重算、读到模型位移前的旧锚点（anchor.y≈0）+ 新窗口尺寸 → `maxHeight = anchor.y - 32 = 0` → 气泡渲染成 0 高不可见 |
| 3. 对话完关面板后 Cmd+点击，菜单+气泡同时出现在屏幕右上象限中部 | 气泡：同上监听顺序竞态——菜单展开的 resize 事件里气泡用「上一次位移后的锚点」+「再次扩大的窗口尺寸」算出 `bottom` 偏大 → 气泡漂到扩展区顶部（屏幕右上象限）；菜单：锚定**窗口左上 (4,4)**，而气泡保持期窗口还带着聊天扩展（520×120），窗口左上 = 角色左上再上移 452px/左移 520px → 菜单远离角色 |
| 4. 连续 Cmd+点击菜单变窄被截断 | `usePetMenu.openMenu` 用 `window.innerWidth`（渲染进程）算 `extraW`，但主进程 `setBounds` 后 resize 事件异步到达——快速开→关→开时读到**上一状态的宽度**（已展开值）→ `extraW=0` → 窗口没加宽，260px 菜单在窄窗口里右侧被裁；同时高度扩展照常 → 模型位移、窗口宽度不变，「渲染的部分被截断」 |
| （连带）菜单打开期间气泡保持期结束 | `useChatPanel.collapse()` 无条件 `setPassthrough(true)`，此时若菜单开着，整窗点击穿透 → 菜单点不到关不掉 |

**核心解法**（对应上方根因）：

1. **几何单一事实来源**：`windowGeometry` store 记录 `size`（resize 事件同步）+ `base`（模型基准窗口尺寸，`model.ts` 发布）。气泡/菜单定位在 React 渲染期推导——渲染晚于整个 resize 事件分发，此时模型位移监听器已执行完，anchor 读取必然新鲜，**监听顺序竞态从结构上消除**。
2. **模型总线 zustand 化**：气泡需在模型就绪时重渲染以重算布局。
3. **replySeq 门控**：气泡只弹「本会话流式产生」的回复。
4. **主进程权威菜单扩展**：`expand-menu(requiredW, requiredH)`，主进程用真实 `getBounds()` 算 `extraW`、`extraH` 给满 332（菜单打开期间头顶空间恒定，其他面板中途收起菜单仍贴头顶）。
5. **菜单锚角色头顶**：`right: 4px` + `top = max(4, headTop - 8 - 320)`，`headTop = size.h - base.h` 响应式。
6. **发送成功自动收起面板** + **延迟收起不再强制穿透**。

## Global Constraints

- 显示名 **AI桌宠**，用户可见文案禁用角色名（天依/洛天依），测试夹具用中性素材名（haru/shizuku）
- Commit：Conventional Commits，subject 小写开头；快速开发阶段直接提交 main
- 前端测试放功能目录 `__test__/`；Go 测试与源码同目录
- 样式：JSX 只写 Tailwind v4 工具类；语义类只留测试锚点（`pet-menu`/`speech-bubble` 等不动）
- 气泡 `pointer-events-none` 必须保留；`ChatPanel` 打开时气泡隐藏的互斥规则保留；`ChatPanel` 只留输入（历史统一进设置）
- 穿透 `forward:true`；`usePassthrough` 的 effect 立即同步必须无条件发 IPC（本地去重会跳过 → 窗口卡死穿透）
- 窗口扩展向左上扩、右下锚定；`windowAnchor` 位移与扩展量同步
- 提交门禁：单测 + `make test`（typecheck+vitest+Go）通过；**视觉复现由用户在 Task 10 用 `make dev` 做**（Electron 桌宠界面无法自动化断言，见「验证后才提交」约定）
- `make dev` 前先 `memory_pressure -Q`（内存吃紧会 SIGTERM 整个 make dev）

---

## 文件结构总览

| 文件 | 动作 | 职责 |
|---|---|---|
| `renderer/src/live2d/windowGeometry.ts` | 新建 | 窗口尺寸 + 模型基准尺寸的 zustand store + resize 同步 hook |
| `renderer/src/live2d/modelBus.ts` | 改造 | zustand 化（保留 `getActiveModel`/`setActiveModel` 导出，新增 `useActiveModel`） |
| `renderer/src/live2d/model.ts` | 小改 | 发布 `setModelBase`；`nextResize` 换用共享 `waitForResize` |
| `renderer/src/live2d/waitForResize.ts` | 新建 | 等下一次 resize 事件（超时兜底 300ms） |
| `renderer/src/store/chatStore.ts` | 小改 | 新增 `replySeq`（delta/done 递增，refresh/clear 不动） |
| `renderer/src/pet/chat/SpeechBubble.tsx` | 改造 | 布局响应式推导 + replySeq 门控弹出 |
| `window/bounds.ts` | 小改 | 纯函数 `menuExpandExtras` |
| `window/manager.ts` | 小改 | `expandForMenu`（主进程权威扩展） |
| `bridge/ipc.ts` | 小改 | `lovelybuddy:expand-menu` 转发 |
| `preload/index.ts` + `renderer/src/env.d.ts` | 小改 | `expandMenu` API（两处类型声明同步改） |
| `renderer/src/pet/menuLayout.ts` | 改造 | `MENU_REQUIRED_W/H` + `menuTop(headTop)` 纯函数（替换 `planMenuPlacement`） |
| `renderer/src/hooks/usePetMenu.ts` | 改造 | `menuOpen: boolean` 状态；expand-menu + waitForResize |
| `renderer/src/pet/PetMenu.tsx` | 小改 | 去 x/y props，`right`/`top` 从几何 store 推导 |
| `renderer/src/App.tsx` | 小改 | `useWindowGeometrySync()`；menu 布尔化 |
| `renderer/src/hooks/useChatPanel.ts` | 改造 | 发送成功自动收起；延迟收起不再强制穿透 |

---

### Task 1: 窗口几何单一事实来源 windowGeometry

**Files:**
- Create: `apps/desktop/src/renderer/src/live2d/windowGeometry.ts`
- Test: `apps/desktop/src/renderer/src/live2d/__test__/windowGeometry.test.ts`

**Interfaces:**
- Produces:
  - `useWindowGeometry` —— zustand store：`{ size: { w: number; h: number }, base: { w: number; h: number } | null }`
  - `setWindowSize(w: number, h: number): void`
  - `setModelBase(base: { w: number; h: number } | null): void`
  - `useWindowGeometrySync(): void` —— 挂载即同步一次 + resize 事件监听（Task 7 的 App 调用）

- [ ] **Step 1: 写失败测试**

```ts
// live2d/__test__/windowGeometry.test.ts
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setModelBase, setWindowSize, useWindowGeometry, useWindowGeometrySync } from '../windowGeometry'

describe('windowGeometry', () => {
  it('setModelBase 发布/清除模型基准尺寸', () => {
    setModelBase({ w: 300, h: 480 })
    expect(useWindowGeometry.getState().base).toEqual({ w: 300, h: 480 })
    setModelBase(null)
    expect(useWindowGeometry.getState().base).toBeNull()
  })

  it('useWindowGeometrySync：挂载即同步尺寸，resize 事件更新 store，卸载后不再同步', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true })
    const { unmount } = renderHook(() => useWindowGeometrySync())
    expect(useWindowGeometry.getState().size).toEqual({ w: 500, h: 300 })

    Object.defineProperty(window, 'innerWidth', { value: 640, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(useWindowGeometry.getState().size).toEqual({ w: 640, h: 300 })

    unmount()
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(useWindowGeometry.getState().size).toEqual({ w: 640, h: 300 }) // 卸载后保持
    setWindowSize(1024, 768) // 复位，不影响其他测试
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/windowGeometry.test.ts`
Expected: FAIL —— 模块不存在，无法导入

- [ ] **Step 3: 实现**

```ts
// live2d/windowGeometry.ts
// 窗口几何单一事实来源：所有"角色/窗口相对位置"的定位（气泡、菜单）都在渲染期
// 从这里响应式推导，而不是各自监听 resize——各监听器的执行顺序会读到
// "模型还没位移的旧锚点 + 新窗口尺寸"（SpeechBubble 注册早于模型位移监听器），
// 造成气泡不可见/错位。React 渲染晚于整个事件分发，anchor 读取时位移已完成。
import { create } from 'zustand'
import { useEffect } from 'react'

export interface WindowSize {
  w: number
  h: number
}

interface WindowGeometryState {
  /** 当前窗口尺寸（resize 事件同步；初始为 store 创建时的值，挂载后由 hook 校正） */
  size: WindowSize
  /** 模型基准窗口尺寸（model.ts 在模型加载/释放时发布）；无模型为 null */
  base: WindowSize | null
}

export const useWindowGeometry = create<WindowGeometryState>()(() => ({
  size: { w: window.innerWidth, h: window.innerHeight },
  base: null
}))

export function setWindowSize(w: number, h: number): void {
  useWindowGeometry.setState({ size: { w, h } })
}

export function setModelBase(base: WindowSize | null): void {
  useWindowGeometry.setState({ base })
}

/** App 挂载时注册：resize 事件 → 同步 size（含初始一次校正） */
export function useWindowGeometrySync(): void {
  useEffect(() => {
    const sync = (): void => setWindowSize(window.innerWidth, window.innerHeight)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/windowGeometry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/live2d/windowGeometry.ts apps/desktop/src/renderer/src/live2d/__test__/windowGeometry.test.ts
git commit -m "feat(desktop): 新增窗口几何 store 作为气泡/菜单定位的单一事实来源"
```

---

### Task 2: modelBus zustand 化 + model.ts 发布基准尺寸

**Files:**
- Modify: `apps/desktop/src/renderer/src/live2d/modelBus.ts`
- Modify: `apps/desktop/src/renderer/src/live2d/model.ts`（`createPetModel` 末尾发布 base、`releasePetModel` 清除 base）
- Test: `apps/desktop/src/renderer/src/live2d/__test__/modelBus.test.ts`

**Interfaces:**
- Consumes: `useWindowGeometry`/`setModelBase`（Task 1）
- Produces: `useActiveModel`（zustand hook，`{ model: PetModel | null }`）；`getActiveModel()`/`setActiveModel(pet)` 签名不变（SpeechBubble/PetCanvas/现有测试继续可用）

- [ ] **Step 1: 写失败测试**

```ts
// live2d/__test__/modelBus.test.ts
import { describe, expect, it } from 'vitest'
import { getActiveModel, setActiveModel, useActiveModel } from '../modelBus'
import type { PetModel } from '../model'

const fakePet = { anchor: { x: 0, y: 0 } } as unknown as PetModel

describe('modelBus', () => {
  it('set/get 往返', () => {
    setActiveModel(fakePet)
    expect(getActiveModel()).toBe(fakePet)
    setActiveModel(null)
    expect(getActiveModel()).toBeNull()
  })

  it('set 通知订阅者（气泡布局依赖模型就绪重渲染）', () => {
    const seen: Array<PetModel | null> = []
    const unsub = useActiveModel.subscribe((s) => seen.push(s.model))
    setActiveModel(fakePet)
    setActiveModel(null)
    unsub()
    expect(seen).toEqual([fakePet, null])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/modelBus.test.ts`
Expected: FAIL —— `useActiveModel` 不存在

- [ ] **Step 3: 实现 modelBus**

```ts
// live2d/modelBus.ts
// 模型实例总线：PetCanvas 加载/销毁时登记，气泡等 UI 借此驱动模型播动作与锚点定位。
// zustand 化（原模块变量无订阅能力）：SpeechBubble 需在模型就绪时重渲染以重算布局。
// PetModel 是命令式 facade（pixi 句柄），只有"就绪/释放"两态变化，订阅开销可忽略。
import { create } from 'zustand'
import type { PetModel } from './model'

export const useActiveModel = create<{ model: PetModel | null }>()(() => ({ model: null }))

export function setActiveModel(pet: PetModel | null): void {
  useActiveModel.setState({ model: pet })
}

export function getActiveModel(): PetModel | null {
  return useActiveModel.getState().model
}
```

- [ ] **Step 4: 改 model.ts 发布基准尺寸**

`apps/desktop/src/renderer/src/live2d/model.ts`：
- import 区加一行：`import { setModelBase } from './windowGeometry'`
- `createPetModel` 中，`model.position.set(window.innerWidth / 2, window.innerHeight - 8)` 之后（`app.stage.addChild(model)` 前）加：

```ts
  // 发布模型基准窗口尺寸（几何 store）：气泡/菜单靠 size.h - base.h 求头顶窗口坐标
  setModelBase({ w: winW, h: winH })
```

- `releasePetModel` 中，`pet.destroy()` 之后加：

```ts
  setModelBase(null) // 模型已释放：几何 store 回到无基准状态
```

（`releasePetModel` 内 `pet.destroy()` 在 `try` 块里，`setModelBase(null)` 放 `try` 之后、函数结尾之前，无论销毁成败都清基准。）

- [ ] **Step 5: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/modelBus.test.ts src/renderer/src/live2d/__test__/`
Expected: PASS（modelBus 新测试 + 既有 live2d 测试不回归；model.ts 的发布逻辑由 Task 4 组件测试与 Task 10 视觉验证覆盖）

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/live2d/modelBus.ts apps/desktop/src/renderer/src/live2d/model.ts apps/desktop/src/renderer/src/live2d/__test__/modelBus.test.ts
git commit -m "feat(desktop): modelBus 改为 zustand 订阅式并发布模型基准窗口尺寸"
```

---

### Task 3: chatStore 增加 replySeq（会话内回复序号）

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/chatStore.ts`
- Test: `apps/desktop/src/renderer/src/store/__test__/chatStore.test.ts`

**Interfaces:**
- Produces: `ChatState.replySeq: number` —— 流式 `delta`（非空文本）/`done`（非空文本）递增；`refresh`/`clear`/`error` 不动。气泡门控信号。

- [ ] **Step 1: 写失败测试**

在 `store/__test__/chatStore.test.ts` 末尾追加（`beforeEach` 的 setState 里加 `replySeq: 0`）：

```ts
describe('chatStore.replySeq', () => {
  it('delta/done 递增（气泡门控信号）', async () => {
    await driveSend([
      { type: 'meta', session_id: 's1' },
      { type: 'delta', text: '你' },
      { type: 'done', text: '你好' }
    ])
    expect(useChatStore.getState().replySeq).toBe(2)
  })

  it('refresh 历史覆盖不递增（启动/断线恢复不重放气泡）', async () => {
    getHistoryMock.mockResolvedValue({
      session_id: 's1',
      messages: [{ role: 'assistant', content: '旧回复', created_at: 't' }]
    })
    await useChatStore.getState().refresh()
    expect(useChatStore.getState().replySeq).toBe(0)
  })

  it('error 事件不递增', async () => {
    await driveSend([{ type: 'meta', session_id: 's1' }, { type: 'error', error: 'x' }])
    expect(useChatStore.getState().replySeq).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/store/__test__/chatStore.test.ts`
Expected: FAIL —— `replySeq` 为 undefined

- [ ] **Step 3: 实现**

`chatStore.ts` 三处改动：

```ts
interface ChatState {
  // ...既有字段后加：
  /** 会话内流式回复序号（delta/done 递增；历史 refresh/clear 不动）——气泡门控：
   *  启动/断线恢复拉历史不重放旧回复，只有本会话流出的内容才触发气泡 */
  replySeq: number
```

```ts
let abort: AbortController | null = null
let motionSeq = 0
let replySeq = 0
```

初始 state 加 `replySeq: 0`；事件处理器：

```ts
          else if (ev.type === 'delta') {
            updateLast((it) => ({ ...it, content: it.content + ev.text }))
            if (ev.text !== '') set({ replySeq: ++replySeq })
          }
          else if (ev.type === 'motion') set({ lastMotion: { intent: ev.intent, seq: ++motionSeq } })
          else if (ev.type === 'done') {
            updateLast((it) => ({ ...it, content: ev.text, motion: ev.motion || undefined }))
            if (ev.text !== '') set({ replySeq: ++replySeq })
          }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/store/__test__/chatStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/store/chatStore.ts apps/desktop/src/renderer/src/store/__test__/chatStore.test.ts
git commit -m "feat(desktop): chatStore 增加 replySeq 会话回复序号供气泡门控"
```

---

### Task 4: SpeechBubble 响应式布局 + replySeq 门控

**Files:**
- Modify: `apps/desktop/src/renderer/src/pet/chat/SpeechBubble.tsx`
- Test: `apps/desktop/src/renderer/src/pet/chat/__test__/SpeechBubble.test.tsx`（整体重写）

**Interfaces:**
- Consumes: `useActiveModel`/`getActiveModel`（Task 2）、`useWindowGeometry`（Task 1）、`replySeq`（Task 3）
- Produces: 组件对外接口不变 —— `<SpeechBubble panelOpen={boolean} />`

- [ ] **Step 1: 重写测试（先红）**

```tsx
// pet/chat/__test__/SpeechBubble.test.tsx
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SpeechBubble from '../SpeechBubble'
import { useChatStore } from '../../../store/chatStore'
import { setActiveModel } from '../../../live2d/modelBus'
import { useWindowGeometry } from '../../../live2d/windowGeometry'
import type { PetModel } from '../../../live2d/model'

const playIntent = vi.fn()
const fakePet = { playIntent, anchor: { x: 0, y: 120 } } as unknown as PetModel

describe('SpeechBubble', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    playIntent.mockReset().mockResolvedValue(true)
    fakePet.anchor = { x: 0, y: 120 }
    setActiveModel(fakePet)
    useWindowGeometry.setState({ size: { w: 300, h: 700 }, base: { w: 300, h: 580 } })
    useChatStore.setState({ items: [], sending: false, error: null, lastMotion: null, replySeq: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
    setActiveModel(null)
    useWindowGeometry.setState({ size: { w: 1024, h: 768 }, base: null })
  })

  it('启动恢复历史（replySeq=0）：不渲染气泡，也不排淡出计时', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好' }] })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(9000)
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
  })

  it('本会话流式回复：弹出打字机，8s 静默后淡出卸载', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好呀，我在' }], sending: true, replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(200) // 打字机推进
    })
    expect(container.querySelector('.speech-bubble-body')!.textContent).toContain('你')
    act(() => {
      useChatStore.setState({ sending: false }) // 流式结束，起 8s 计时
    })
    act(() => {
      vi.advanceTimersByTime(8100)
    })
    expect(container.querySelector('.speech-bubble--out')).toBeTruthy() // 淡出中
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(container.querySelector('.speech-bubble')).toBeNull() // 卸载
  })

  it('完整展示过的回复：历史刷新（内容变化、replySeq 不变）不重放', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '旧回复' }], replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    act(() => {
      vi.advanceTimersByTime(8300) // 淡出完成，标记已展示
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
    useChatStore.setState({ items: [{ role: 'assistant', content: '刷新后的历史' }], replySeq: 1 })
    expect(container.querySelector('.speech-bubble')).toBeNull()
  })

  it('面板打开时不渲染；面板关闭后同一回复重新弹出', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好' }], replySeq: 1 })
    const { container, rerender } = render(<SpeechBubble panelOpen />)
    expect(container.querySelector('.speech-bubble')).toBeNull()
    rerender(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble')).toBeTruthy()
  })

  it('motion 事件驱动当前模型播动作', () => {
    useChatStore.setState({
      items: [{ role: 'assistant', content: '哈' }],
      sending: true,
      replySeq: 1,
      lastMotion: { intent: 'happy', seq: 1 }
    })
    render(<SpeechBubble panelOpen={false} />)
    expect(playIntent).toHaveBeenCalledWith('happy')
  })

  it('非法意图不触发动作', () => {
    useChatStore.setState({
      items: [{ role: 'assistant', content: '哈' }],
      sending: true,
      replySeq: 1,
      lastMotion: { intent: 'dance', seq: 2 }
    })
    render(<SpeechBubble panelOpen={false} />)
    expect(playIntent).not.toHaveBeenCalled()
  })

  it('尾巴锚定模型头部左上角（几何 store 换算 right/bottom）', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '嗨' }], sending: true, replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    const el = container.querySelector('.speech-bubble') as HTMLElement
    expect(el.style.right).toBe('276px') // 300 - 0 - TAIL_INSET(24)
    expect(el.style.bottom).toBe('604px') // 700 - 120 + 16 + 8
    expect(el.style.maxHeight).toBe('88px') // 120 - 16 - 8 - 8
  })

  it('窗口扩展后布局随几何 store 更新：气泡仍贴头顶不漂移（回归：监听顺序竞态）', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '嗨' }], sending: true, replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    // 聊天扩展 520×120 + 菜单扩展 0×332 落地：窗口 820×1152，模型位移后 anchor.y=452
    useWindowGeometry.setState({ size: { w: 820, h: 1152 }, base: { w: 300, h: 580 } })
    fakePet.anchor = { x: 520, y: 452 }
    const el = container.querySelector('.speech-bubble') as HTMLElement
    expect(el.style.bottom).toBe('724px') // 1152 - 452 + 24：贴头顶；旧实现会算出 1152-120+24=1056 漂到窗口顶
  })

  it('无模型时回退居中样式', () => {
    setActiveModel(null)
    useChatStore.setState({ items: [{ role: 'assistant', content: '嗨' }], sending: true, replySeq: 1 })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble--center')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/chat/__test__/SpeechBubble.test.tsx`
Expected: FAIL —— replySeq 门控/几何 store 用例红（组件仍用旧布局 effect）

- [ ] **Step 3: 重写组件**

```tsx
// pet/chat/SpeechBubble.tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '../../store/chatStore'
import { getActiveModel, useActiveModel } from '../../live2d/modelBus'
import { useWindowGeometry } from '../../live2d/windowGeometry'
import { INTENT_MOTIONS, type MotionIntent } from '../../live2d/motionMap'
import { useTypewriter } from '../../hooks/useTypewriter'
import { bubbleOffsets } from './bubbleLayout'
import { HIDE_AFTER_MS, FADE_MS } from './bubbleTiming'

interface Props {
  /** 聊天面板打开时让位（回复显示在面板历史里），气泡隐藏——互斥规则保留 */
  panelOpen: boolean
}

/**
 * 打字机气泡：尾巴尖端锚定模型头部左上角上方 16px（PetModel.anchor）。
 * 布局在渲染期响应式推导（几何 store + 模型总线），不再自行监听 resize——
 * 监听顺序会让气泡读到"模型未位移的旧锚点 + 新窗口尺寸"，造成不可见/错位。
 * 弹出门控 replySeq：只展示本会话流式产生的回复（历史刷新不重放）；完整展示
 * 完毕（淡出完成）后记录序号，同一回复不重放。
 * 纯展示（pointer-events:none，不加 data-interactive、不参与穿透状态机——点击穿到桌面）。
 */
export default function SpeechBubble({ panelOpen }: Props): ReactElement | null {
  const items = useChatStore((s) => s.items)
  const sending = useChatStore((s) => s.sending)
  const lastMotion = useChatStore((s) => s.lastMotion)
  const replySeq = useChatStore((s) => s.replySeq)
  const pet = useActiveModel((s) => s.model)
  const { size } = useWindowGeometry()
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('gone')
  const outTimerRef = useRef<number | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const shownSeqRef = useRef(0)

  const last = items.length > 0 ? items[items.length - 1] : null
  const isReply = last !== null && last.role === 'assistant' && last.content !== ''
  const shown = useTypewriter(phase !== 'gone' && !panelOpen && isReply ? last.content : '')

  // 布局：anchor getter 实时读模型位置（windowAnchor 位移后仍准确），窗口尺寸来自几何 store
  const layout = pet ? bubbleOffsets(pet.anchor, size.w, size.h) : null

  useEffect(() => {
    if (panelOpen || !isReply) {
      setPhase('gone')
      return
    }
    // 门控：replySeq=0（纯历史）或已完整展示过 → 不弹出
    if (replySeq !== 0 && replySeq !== shownSeqRef.current) {
      setPhase('in')
    }
    if (sending) return // 流式中不计时；sending 翻 false 会重跑本 effect 起计时
    if (phaseRef.current !== 'in') return // 未展示不排淡出计时（启动历史静默）
    const id = window.setTimeout(() => {
      setPhase('out')
      outTimerRef.current = window.setTimeout(() => {
        shownSeqRef.current = replySeq // 完整展示完毕，历史刷新等不再重放
        setPhase('gone')
      }, FADE_MS)
    }, HIDE_AFTER_MS)
    return () => {
      window.clearTimeout(id)
      if (outTimerRef.current !== null) {
        window.clearTimeout(outTimerRef.current)
        outTimerRef.current = null
      }
    }
  }, [panelOpen, isReply, sending, replySeq])

  // motion 事件 → 当前模型播动作（seq 去重，一次事件一个动作）
  const seqRef = useRef(0)
  useEffect(() => {
    if (lastMotion === null || lastMotion.seq === seqRef.current) return
    seqRef.current = lastMotion.seq
    if (lastMotion.intent in INTENT_MOTIONS) {
      void getActiveModel()?.playIntent(lastMotion.intent as MotionIntent)
    }
  }, [lastMotion])

  if (phase === 'gone' || panelOpen || !isReply) return null
  const classes = [
    // pointer-events-none 必须保留：点击穿到桌面（README 铁律）
    'speech-bubble fixed z-[80] flex flex-col items-end pointer-events-none',
    phase === 'out' ? 'speech-bubble--out' : '',
    layout === null ? 'speech-bubble--center' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const style =
    layout === null
      ? undefined
      : { right: layout.right, bottom: layout.bottom, maxWidth: layout.maxWidth, maxHeight: layout.maxHeight }
  return (
    <div className={classes} style={style} aria-live="polite">
      <div className="speech-bubble-body max-w-full overflow-y-auto px-4 py-(--sp-2) rounded-bubble bg-surface text-ink text-(--fs-body) leading-[1.6] whitespace-pre-wrap break-words shadow-mint animate-bubble-pop origin-bottom-right">
        {shown}
      </div>
      {/* right 与 bubbleLayout.TAIL_INSET 对齐 */}
      <span className="speech-bubble-tail absolute right-[24px] -bottom-1.5 size-3 bg-surface rounded-bl rotate-45" aria-hidden="true" />
    </div>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/chat/__test__/SpeechBubble.test.tsx && pnpm vitest run src/renderer/src/hooks/__test__/useTypewriter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/pet/chat/SpeechBubble.tsx apps/desktop/src/renderer/src/pet/chat/__test__/SpeechBubble.test.tsx
git commit -m "fix(desktop): 气泡布局改为几何 store 响应式推导并加 replySeq 弹出门控"
```

---

### Task 5: 主进程权威菜单扩展（bounds 纯函数 + manager + IPC + preload）

**Files:**
- Modify: `apps/desktop/src/window/bounds.ts`
- Modify: `apps/desktop/src/window/manager.ts`
- Modify: `apps/desktop/src/bridge/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/env.d.ts`（LovelybuddyApi 类型同步）
- Test: `apps/desktop/src/window/__test__/bounds.test.ts`

**Interfaces:**
- Consumes: `PetWindowManager.expandFor(key, extraW, extraH)`（既有）
- Produces:
  - `menuExpandExtras(current: Rect, requiredW: number, requiredH: number): { width: number; height: number }`
  - `PetWindowManager.expandForMenu(requiredW: number, requiredH: number): { width: number; height: number }`
  - `window.lovelybuddy.expandMenu(requiredW: number, requiredH: number): Promise<{ width: number; height: number }>`

- [ ] **Step 1: 写失败测试**

`window/__test__/bounds.test.ts` 追加：

```ts
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
```

并更新文件头 import 加 `menuExpandExtras`。

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/window/__test__/bounds.test.ts`
Expected: FAIL —— `menuExpandExtras` 不存在

- [ ] **Step 3: 实现 bounds.ts 纯函数**

```ts
/** 菜单展开的扩展量（主进程权威，杜绝渲染进程 stale innerWidth 竞态——连续
 *  Cmd+点击时渲染进程的 resize 事件落后于主进程 setBounds，读窗口尺寸会算错）：
 *  - 宽：按当前窗口真实宽度补足 requiredW（菜单右贴窗口，宽度不足向左扩）。
 *  - 高：绝对 requiredH——菜单打开期间头顶空间恒定（≥requiredH），其他面板
 *    中途收起（如气泡保持期结束）菜单仍贴头顶不压角色。 */
export function menuExpandExtras(current: Rect, requiredW: number, requiredH: number): { width: number; height: number } {
  return {
    width: Math.max(0, requiredW - current.width),
    height: requiredH
  }
}
```

- [ ] **Step 4: 实现 manager.expandForMenu + IPC + preload 类型**

`manager.ts`（import 区加 `menuExpandExtras`；类内 `collapseFor` 之后加）：

```ts
  /** 菜单展开（main 权威）：requiredW/H 为菜单+内边距的绝对需求（渲染进程传常量）。
   *  宽用当前真实 bounds 补足（渲染进程 innerWidth 落后于 resize 事件，读它会被
   *  连续 Cmd+点击竞态算错导致菜单截断）；高给满保证菜单打开期间头顶空间恒定。 */
  expandForMenu(requiredW: number, requiredH: number): { width: number; height: number } {
    const w = this.win
    if (!w) return { width: 0, height: 0 }
    const extras = menuExpandExtras(w.getBounds(), requiredW, requiredH)
    return this.expandFor('menu', extras.width, extras.height)
  }
```

`bridge/ipc.ts`（`expand-window` 处理器之后加）：

```ts
  // 菜单展开：主进程按真实 bounds 计算扩展量（渲染进程 innerWidth 落后 resize 事件，
  // 连续 Cmd+点击会读到过期宽度导致菜单被截断）
  ipcMain.handle('lovelybuddy:expand-menu', (_e, requiredW: number, requiredH: number) =>
    win.expandForMenu(requiredW, requiredH))
```

`preload/index.ts` 的 `LovelybuddyApi` 接口（`expandWindow` 之后）与实现（同位置）各加：

```ts
  /** 菜单展开：主进程按当前真实窗口尺寸计算扩展量，返回扩展后实际尺寸 */
  expandMenu: (requiredW: number, requiredH: number) => Promise<{ width: number; height: number }>
```

```ts
  expandMenu: (requiredW, requiredH) => ipcRenderer.invoke('lovelybuddy:expand-menu', requiredW, requiredH),
```

`renderer/src/env.d.ts` 的 `LovelybuddyApi` 接口（与 preload 保持一致）同样加 `expandMenu` 字段（注释同上）。

- [ ] **Step 5: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/window/__test__/bounds.test.ts && pnpm tsc --noEmit -p tsconfig.web.json && pnpm tsc --noEmit -p tsconfig.node.json`
Expected: PASS（tsc 配置文件若与仓库实际命名不符，用 package.json 里的 typecheck 脚本：`pnpm typecheck`）

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/window/bounds.ts apps/desktop/src/window/manager.ts apps/desktop/src/bridge/ipc.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/env.d.ts apps/desktop/src/window/__test__/bounds.test.ts
git commit -m "feat(desktop): 菜单扩展改为主进程按真实 bounds 权威计算"
```

---

### Task 6: waitForResize + menuLayout 纯函数 + model.ts 换用共享实现

**Files:**
- Create: `apps/desktop/src/renderer/src/live2d/waitForResize.ts`
- Modify: `apps/desktop/src/renderer/src/pet/menuLayout.ts`
- Modify: `apps/desktop/src/renderer/src/live2d/model.ts`（删除私有 `nextResize`，换用共享 `waitForResize`）
- Test: `apps/desktop/src/renderer/src/live2d/__test__/waitForResize.test.ts`
- Test: `apps/desktop/src/renderer/src/pet/__test__/menuLayout.test.ts`（重写）

**Interfaces:**
- Produces:
  - `waitForResize(timeoutMs?: number): Promise<void>` —— 下一次 resize 事件即 resolve，超时兜底 300ms
  - `MENU_W = 280`、`MENU_H = 320`、`MENU_INSET = 4`、`MENU_REQUIRED_W = 288`、`MENU_REQUIRED_H = 332`
  - `menuTop(headTop: number): number` —— 菜单 top 窗口坐标：`max(4, headTop - 8 - 320)`

- [ ] **Step 1: 写失败测试**

```ts
// live2d/__test__/waitForResize.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForResize } from '../waitForResize'

describe('waitForResize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resize 事件到达即 resolve', async () => {
    let settled = false
    void waitForResize().then(() => {
      settled = true
    })
    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })

  it('无 resize 事件：300ms 超时兜底 resolve', async () => {
    let settled = false
    void waitForResize().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(settled).toBe(true)
  })
})
```

```ts
// pet/__test__/menuLayout.test.ts（重写）
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/waitForResize.test.ts src/renderer/src/pet/__test__/menuLayout.test.ts`
Expected: FAIL —— 模块/导出不存在（menuLayout 测试先失败在导入上）

- [ ] **Step 3: 实现 waitForResize**

```ts
// live2d/waitForResize.ts
/** 等下一次窗口 resize 事件（主进程 setBounds 后渲染进程尺寸异步落地，模型位移
 *  随之完成）。超时兜底 300ms：扩展被屏幕夹紧无尺寸变化时没有 resize 事件，
 *  不能卡死打开流程。 */
export function waitForResize(timeoutMs = 300): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, timeoutMs)
    function done(): void {
      window.removeEventListener('resize', done)
      window.clearTimeout(timer)
      resolve()
    }
    window.addEventListener('resize', done)
  })
}
```

- [ ] **Step 4: 实现 menuLayout 新 API**

```ts
// pet/menuLayout.ts
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
```

- [ ] **Step 5: model.ts 换用共享 waitForResize**

`model.ts`：
- import 区加：`import { waitForResize } from './waitForResize'`
- 调用点 `await nextResize()` 改为 `await waitForResize()`
- 删除文件末尾的私有函数：

```ts
/** 等窗口完成 resize（主进程 setBounds 触发 window resize 事件），超时兜底 300ms。 */
function nextResize(timeoutMs = 300): Promise<void> {
  ...
}
```

- [ ] **Step 6: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/ src/renderer/src/pet/__test__/menuLayout.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/live2d/waitForResize.ts apps/desktop/src/renderer/src/live2d/model.ts apps/desktop/src/renderer/src/live2d/__test__/waitForResize.test.ts apps/desktop/src/renderer/src/pet/menuLayout.ts apps/desktop/src/renderer/src/pet/__test__/menuLayout.test.ts
git commit -m "feat(desktop): 提取 waitForResize 共享等待并重定义菜单布局为角色头顶锚定"
```

---

### Task 7: usePetMenu + PetMenu + App 接入新菜单链路

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/usePetMenu.ts`
- Modify: `apps/desktop/src/renderer/src/pet/PetMenu.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Test: `apps/desktop/src/renderer/src/hooks/__test__/usePetMenu.test.ts`（重写）
- Test: `apps/desktop/src/renderer/src/pet/__test__/PetMenu.test.tsx`（调整）

**Interfaces:**
- Consumes: `expandMenu`（Task 5）、`waitForResize`/`menuTop`/`MENU_*`（Task 6）、`useWindowGeometry`（Task 1）
- Produces: `usePetMenu(): { menuOpen: boolean; openMenu: () => void; closeMenu: () => void }`；`PetMenu` 无位置 props

- [ ] **Step 1: 重写 usePetMenu 测试（先红）**

```ts
// hooks/__test__/usePetMenu.test.ts
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePetMenu } from '../usePetMenu'
import { MENU_REQUIRED_H, MENU_REQUIRED_W } from '../../pet/menuLayout'

const expandMenu = vi.fn()
const collapseWindow = vi.fn()
const setPassthrough = vi.fn()

function mockLovelybuddy(): void {
  expandMenu.mockReset().mockResolvedValue({ width: 400, height: 800 })
  collapseWindow.mockReset()
  setPassthrough.mockReset()
  vi.stubGlobal('lovelybuddy', { expandMenu, collapseWindow, setPassthrough })
}

describe('usePetMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockLovelybuddy()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('openMenu 用菜单需求尺寸请求主进程权威扩展，resize 落地后 menuOpen=true', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    expect(expandMenu).toHaveBeenCalledWith(MENU_REQUIRED_W, MENU_REQUIRED_H)
    // expand 已 resolve 但 resize 未落地：菜单先不显示（防首帧错位闪烁）
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.menuOpen).toBe(false)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.menuOpen).toBe(true)
  })

  it('扩展被屏幕夹紧无 resize 事件：300ms 超时后照常打开', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(result.current.menuOpen).toBe(true)
  })

  it('closeMenu 缩回窗口并恢复穿透', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    act(() => {
      result.current.closeMenu()
    })
    expect(result.current.menuOpen).toBe(false)
    expect(collapseWindow).toHaveBeenCalledWith('menu')
    expect(setPassthrough).toHaveBeenCalledWith(true)
  })

  it('点开又立刻关掉：resize 落地后菜单保持关闭（令牌失效）', async () => {
    let resolveExpand!: (size: { width: number; height: number }) => void
    expandMenu.mockImplementation(
      () =>
        new Promise<{ width: number; height: number }>((resolve) => {
          resolveExpand = resolve
        })
    )
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    act(() => {
      result.current.closeMenu()
    })
    await act(async () => {
      resolveExpand({ width: 400, height: 800 })
      await Promise.resolve()
    })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.menuOpen).toBe(false)
  })

  it('点菜单外（data-interactive 之外）关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    fireEvent.pointerDown(document.body)
    expect(result.current.menuOpen).toBe(false)
  })

  it('点 data-interactive 内不关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    const panel = document.createElement('div')
    panel.setAttribute('data-interactive', '')
    document.body.appendChild(panel)
    fireEvent.pointerDown(panel)
    expect(result.current.menuOpen).toBe(true)
    panel.remove()
  })

  it('Esc 关闭菜单', async () => {
    const { result } = renderHook(() => usePetMenu())
    act(() => {
      result.current.openMenu()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.menuOpen).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/hooks/__test__/usePetMenu.test.ts`
Expected: FAIL —— `expandMenu`/`menuOpen` 不存在

- [ ] **Step 3: 实现 usePetMenu**

```ts
// hooks/usePetMenu.ts
import { useEffect, useRef, useState } from 'react'
import { MENU_REQUIRED_H, MENU_REQUIRED_W } from '../pet/menuLayout'
import { waitForResize } from '../live2d/waitForResize'

/**
 * 右键菜单状态机：
 * - openMenu：扩展量由主进程权威计算（expandMenu 按真实 bounds 补宽，杜绝渲染进程
 *   stale innerWidth 竞态）；扩展 resolve 后再等一次 resize 落地（模型位移完成），
 *   菜单首帧即贴头顶；菜单位置由 PetMenu 按几何 store 响应式推导（锚角色头顶，
 *   聊天扩展叠加时不再飘到窗口左上）。
 * - closeMenu：缩回窗口、恢复穿透（交给 usePassthrough 状态机接管）。
 * - 菜单打开期间：点菜单外（含模型本体——tap 由 interact 的屏幕坐标判定正常触发）
 *   或 Esc 关闭。
 */
export function usePetMenu(): {
  menuOpen: boolean
  openMenu: () => void
  closeMenu: () => void
} {
  const [menuOpen, setMenuOpen] = useState(false)
  const tokenRef = useRef(0)

  const openMenu = (): void => {
    const token = ++tokenRef.current
    void window.lovelybuddy.expandMenu(MENU_REQUIRED_W, MENU_REQUIRED_H).then(async () => {
      if (token !== tokenRef.current) return // 期间已关闭/重开
      await waitForResize() // 窗口尺寸异步落地；超时兜底 300ms
      if (token !== tokenRef.current) return
      setMenuOpen(true)
    })
  }

  const closeMenu = (): void => {
    tokenRef.current++ // 使未完成的 openMenu 失效
    setMenuOpen(false)
    window.lovelybuddy.collapseWindow('menu')
    window.lovelybuddy.setPassthrough(true) // 立即恢复穿透，交给 usePassthrough 状态机接管
  }

  useEffect(() => {
    if (!menuOpen) return
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
  }, [menuOpen])

  return { menuOpen, openMenu, closeMenu }
}
```

- [ ] **Step 4: 改 PetMenu（位置几何响应式）**

`PetMenu.tsx`：删除 `Props` 里的 `x: number; y: number`，加 import 与定位：

```tsx
import { useState, type ReactElement } from 'react'
import { usePetStore } from '../store/petStore'
import { useWindowGeometry } from '../live2d/windowGeometry'
import { menuTop, MENU_INSET } from './menuLayout'
import ImportPanel from './ImportPanel'

interface Props {
  onClose: () => void
  /** 「聊天」入口（关闭菜单并打开聊天面板，由 App 决定） */
  onChat: () => void
  /** 「设置」入口（关闭菜单并打开设置面板，由 App 决定） */
  onSettings: () => void
}

/**
 * 右键点击角色弹出来的小菜单（非常驻）：状态行 + 形象切换 + 导入/删除 + 聊天入口。
 * 位置响应式：右贴窗口（right=MENU_INSET），底边距头顶 8px（几何 store 实时推导）——
 * 聊天扩展等叠加时窗口左上角远离角色，菜单必须锚角色头顶而不是窗口左上。
 * 关闭 = 点菜单外 / 再右键 / Esc，由 App 统一处理。
 */
export default function PetMenu({ onClose, onChat, onSettings }: Props): ReactElement {
  const { size, base } = useWindowGeometry()
  const top = base ? menuTop(size.h - base.h) : MENU_INSET
  // ...中间内容不变（models/modelUrl/状态行/切换列表/按钮/ImportPanel）
  return (
    <div
      className="pet-menu fixed z-[100] flex flex-col gap-(--sp-1) w-[260px] h-[320px] overflow-y-auto p-(--sp-2) border border-(--color-border) rounded-panel bg-bg text-ink text-xs shadow-mint select-none"
      data-interactive
      style={{ top, right: MENU_INSET }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ...内容不变 */}
    </div>
  )
}
```

- [ ] **Step 5: 调整 PetMenu 测试**

`pet/__test__/PetMenu.test.tsx`：
- `renderMenu` 改为不带 x/y：`render(<PetMenu onClose={onClose} onChat={() => {}} onSettings={onSettings} />)`；其余 `render(<PetMenu x={...} y={...} .../>)` 同样去掉 x/y
- 新增定位用例（import 加 `useWindowGeometry`）：

```tsx
  it('菜单右贴窗口、底边距头顶 8px（几何响应式）', () => {
    useWindowGeometry.setState({ size: { w: 820, h: 932 }, base: { w: 300, h: 480 } })
    render(<PetMenu onClose={() => {}} onChat={() => {}} onSettings={() => {}} />)
    const el = screen.getByText(/AI桌宠/).closest('.pet-menu') as HTMLElement
    expect(el.style.top).toBe('124px') // 932 - 480 - 8 - 320（聊天扩展在身）
    expect(el.style.right).toBe('4px')
    useWindowGeometry.setState({ base: null, size: { w: 1024, h: 768 } })
  })
```

- [ ] **Step 6: 改 App.tsx 接线**

`App.tsx`：

```tsx
import { useWindowGeometrySync } from './live2d/windowGeometry'
// ...
export default function App(): ReactElement {
  // ...
  const { menuOpen, openMenu, closeMenu } = usePetMenu()
  const { open: chatOpen, openPanel } = useChatPanel()
  useWindowGeometrySync()
  // ...
  <PetCanvas
    url={modelUrl}
    name={modelName ?? ''}
    menuOpen={menuOpen}
    chatOpen={chatOpen}
    onMenu={() => {
      if (menuOpen) closeMenu()
      else openMenu()
    }}
  />
  // ...
  {menuOpen && (
    <PetMenu
      onClose={closeMenu}
      onChat={() => {
        closeMenu()
        openPanel()
      }}
      onSettings={() => {
        closeMenu()
        void window.lovelybuddy.openSettings()
      }}
    />
  )}
```

- [ ] **Step 7: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/hooks/__test__/usePetMenu.test.ts src/renderer/src/pet/__test__/PetMenu.test.tsx src/renderer/src/__test__/App.test.tsx`
Expected: PASS（App.test.tsx 若断言行数/交互，按新 API 调整）

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/usePetMenu.ts apps/desktop/src/renderer/src/pet/PetMenu.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/hooks/__test__/usePetMenu.test.ts apps/desktop/src/renderer/src/pet/__test__/PetMenu.test.tsx
git commit -m "fix(desktop): 菜单改为锚角色头顶的几何响应式定位"
```

---

### Task 8: 发送成功自动收起面板 + 延迟收起不再强制穿透

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useChatPanel.ts`
- Test: `apps/desktop/src/renderer/src/hooks/__test__/useChatPanel.test.ts`

**Interfaces:**
- 对外接口不变：`useChatPanel(): { open: boolean; openPanel: () => void; closePanel: () => void }`

- [ ] **Step 1: 写失败测试**

`useChatPanel.test.ts` 追加（并更新既有用例，见 Step 3 说明）：

```ts
  it('流式成功结束自动收起面板（气泡接管展示）', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    useChatStore.setState({ items: [{ role: 'assistant', content: '回复' }], sending: true, error: null })
    act(() => useChatStore.setState({ sending: false }))
    expect(result.current.open).toBe(false)
    expect(collapseWindow).not.toHaveBeenCalled() // 气泡保持期
    act(() => vi.advanceTimersByTime(BUBBLE_HOLD_MS))
    expect(collapseWindow).toHaveBeenCalledWith('chat')
  })

  it('出错不自动收起（错误行+重试留在面板）', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    useChatStore.setState({ sending: true })
    act(() => useChatStore.setState({ sending: false, error: '后端离线' }))
    expect(result.current.open).toBe(true)
  })

  it('空回复不自动收起', async () => {
    const { result } = renderHook(() => useChatPanel())
    await openPanelOf(result)
    useChatStore.setState({ items: [{ role: 'user', content: '嗨' }], sending: true })
    act(() => useChatStore.setState({ sending: false }))
    expect(result.current.open).toBe(true)
  })
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/hooks/__test__/useChatPanel.test.ts`
Expected: FAIL —— 自动收起用例红

- [ ] **Step 3: 实现**

`useChatPanel.ts` 两处改动：

```ts
  const collapse = (): void => {
    if (!expandedRef.current) return
    expandedRef.current = false
    window.lovelybuddy.collapseWindow('chat')
    // 不再强制 setPassthrough(true)：面板关闭时 usePassthrough 已恢复穿透；
    // 延迟收起若发生在菜单打开期间，强制穿透会让菜单点不到（点击穿到桌面）
  }
```

`closePanel` 之后（`// 面板打开/流式中...` 的 effect 之前）加：

```ts
  // 流式成功结束 → 自动收起面板，气泡接管展示；出错保持面板（错误行+重试）。
  // 只响应 true→false 跳变：面板关闭途中（open 已 false）不重复触发。
  const prevSendingRef = useRef(sending)
  useEffect(() => {
    const was = prevSendingRef.current
    prevSendingRef.current = sending
    if (!was || sending) return
    const { error, items } = useChatStore.getState()
    const last = items[items.length - 1]
    if (error === null && last && last.role === 'assistant' && last.content !== '') {
      closePanel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending])
```

同时更新既有用例「closePanel 不立即缩回：气泡期保持扩展，BUBBLE_HOLD_MS 后缩回并恢复穿透」：删除对 `setPassthrough` 的断言，改为：

```ts
    act(() => vi.advanceTimersByTime(BUBBLE_HOLD_MS))
    expect(collapseWindow).toHaveBeenCalledWith('chat')
    expect(setPassthrough).not.toHaveBeenCalled() // 延迟收起不再强制穿透（穿透由 usePassthrough 状态机管）
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/hooks/__test__/useChatPanel.test.ts src/renderer/src/hooks/__test__/usePassthrough.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useChatPanel.ts apps/desktop/src/renderer/src/hooks/__test__/useChatPanel.test.ts
git commit -m "fix(desktop): 流式成功结束自动收起面板且延迟收起不再强制穿透"
```

---

### Task 9: 文档同步

**Files:**
- Modify: `CLAUDE.md`（约定与坑：窗口扩展、穿透状态机）
- Modify: `docs/design.md`（如菜单/气泡交互描述与本次行为冲突）

**Interfaces:** 无

- [ ] **Step 1: 更新 CLAUDE.md**

「约定与坑」节：
- 「穿透状态机」bullet 末尾追加：`延迟收起（useChatPanel 气泡保持期结束）不再强制穿透——菜单打开期间会吞掉菜单点击`
- 「窗口扩展」bullet 追加：`菜单展开量由主进程按真实 bounds 计算（expand-menu，渲染进程 innerWidth 落后 resize 事件会算错宽度）；气泡/菜单定位统一走 live2d/windowGeometry 几何 store 渲染期推导，组件不得自行监听 resize 定位（监听顺序竞态）`

「架构速览」节 `live2d/` 行补充：`windowGeometry（窗口尺寸+模型基准尺寸单一事实来源）、waitForResize`

- [ ] **Step 2: 检查并同步 design.md**

`grep -n "菜单\|气泡\|输入条" docs/design.md` —— 若存在与以下新行为冲突的描述则改为一致：
- 发送成功后输入条自动收起、气泡展示回复（错误时保持打开可重试）
- 菜单右贴窗口、底边距角色头顶 8px（不再固定窗口左上）
- 启动/断线恢复拉历史不再弹气泡（只弹本会话流式回复）
无冲突描述则不改 design.md。

- [ ] **Step 3: 全量测试 + Commit**

```bash
cd /Users/yoshiko/code/agent/lovely-buddy && make test
```
Expected: Go vet/test + typecheck + vitest 全绿。

```bash
git add CLAUDE.md docs/design.md
git commit -m "docs: 同步气泡/菜单定位与穿透约定"
```
（若 design.md 无改动，`git add CLAUDE.md` 即可。）

---

### Task 10: 全链路手动视觉验证（用户执行，发现缺陷另起修复 commit）

**Files:** 无（验证任务）

- [ ] **Step 1: 内存检查后启动**

```bash
memory_pressure -Q   # 内存吃紧会 SIGTERM 整个 make dev
make dev
```

- [ ] **Step 2: 复现四症状（应全部修复）**

1. **启动覆盖**：带着历史记录启动 → 角色应正常站立，**无**气泡弹出覆盖角色
2. **发送后气泡**：Cmd+点击角色 → 菜单 → 聊天 → 输入并发送 → 生成中显示停止键 → 完成后**面板自动消失**，气泡在**头顶上方**打字机展示，8s 后淡出
3. **Cmd+点击位置**：气泡保持期内 Cmd+点击角色 → 菜单**紧贴头顶**（角色右上方、底边距头顶约 8px），气泡**不漂移**；关菜单后气泡仍正确
4. **连续 Cmd+点击**：快速连续 Cmd+点击多次 → 菜单宽度稳定 260px **不截断**、位置不漂移、角色屏幕位置不动

- [ ] **Step 3: 回归清单**

- 拖拽移动角色、点击播 tap、穿透点击（模型外点击穿到桌面）
- 菜单内切换形象 → 角色切换后气泡/菜单定位仍正确
- 菜单打开期间等气泡保持期结束 → 菜单仍可点击关闭（不被穿透吞掉）
- 设置窗口清空对话 → 桌宠侧不弹气泡（replySeq 门控）
- 后端断线恢复 → 历史刷新不重放气泡
- `make test` 全绿；临时诊断日志（如有）用完即删

- [ ] **Step 4: 发现问题 → 单独 fix commit**

视觉验证发现的缺陷按「报错方同款工具复现 + 修复 + 单测回归 + 再验证」循环处理，commit 走 Conventional Commits。

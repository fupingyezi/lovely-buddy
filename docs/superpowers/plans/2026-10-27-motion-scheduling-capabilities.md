# 模型动作调度与能力目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修好动作调度（优先级/空闲计时），并让没有语义动作组的第三方模型也能通过表情与通用动作「有反应」。

**Architecture:** 新增纯逻辑模块 `motionScheduler.ts` 统一管理动作优先级、冷却与空闲循环（可 fake timer 单测，不依赖 PIXI）；新增 `capabilities.ts` 在模型加载时生成能力目录（动作组+表情），`actions.ts` 按五层降级解析意图（avatar.json 手工映射 → 内置组+表情规则 → 纯表情 → 通用动作 → idle 兜底）。model.ts 只做接线。服务端透传 avatar.json 的 `actions` 字段，不经校验（有效性由前端按真实能力目录降级处理）。

**Tech Stack:** TypeScript + vitest（fake timers）、pixi-live2d-display-lipsyncpatch、Go + gin（仅透传字段）。

**Spec:** `docs/design.md`（M2 的 `[motion:]` 协议、M3 的 motion 映射）；本计划实现用户提案的 P0（修优先级、idle 调度和测试）与 P1（动作/表情能力目录与 avatar.json 映射）。P2（行为编排状态机）与 P3（TTS/口型）另立计划。

## Global Constraints

- 用户可见文案禁用具体角色名；测试夹具用中性素材名（haru/shizuku）
- Conventional Commits，subject 小写开头
- 前端测试放功能目录 `__test__/`，Go 测试与源码同目录
- .prettierrc：单引号/无分号/无尾逗号/120 宽；提交前 `pnpm format:check`
- 注释直接描述设计，不引用 spec 章节/文档路径
- 纯逻辑改动由执行者 commit；涉及视觉效果的验收由用户执行冒烟确认

---

## File Structure

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/renderer/src/live2d/motionScheduler.ts` | **新增**。动作调度器（纯逻辑）：优先级记账、同意图冷却、空闲循环单一定时器、表情 hold/reset（motionExpr 所有权，无世代守卫） |
| `apps/desktop/src/renderer/src/live2d/capabilities.ts` | **新增**。`ModelCapabilities` 类型 + `deriveCapabilities()` 从已加载模型读动作组/表情 |
| `apps/desktop/src/renderer/src/live2d/actions.ts` | **新增**。`AvatarActionSpec`/`AvatarActions`/`resolveAction()` 五层降级解析（纯逻辑） |
| `apps/desktop/src/renderer/src/live2d/model.ts` | 接入调度器；Task 4 后接能力目录+解析器；删除内联 idle 循环与 `motionGroups()` |
| `apps/desktop/src/renderer/src/live2d/motionMap.ts` | Task 6 删除 `pickMotion`（被 resolveAction 取代），保留 `INTENT_MOTIONS` 与 `parseMotionTags` |
| `apps/desktop/src/renderer/src/env.d.ts` | `AvatarInfo.actions?: AvatarActions` |
| `apps/desktop/src/renderer/src/lib/assetsApi.ts` | RawAvatar/toAvatar 透传 `actions` |
| `apps/desktop/src/renderer/src/store/petStore.ts` | 新增 `modelActions` 状态，随选中模型更新 |
| `apps/desktop/src/renderer/src/App.tsx`、`pet/PetCanvas.tsx` | 把 `actions` 传入 `loadPetModel` |
| `server/internal/assets/avatar.go` | `AvatarActionSpec` + avatar.json/Avatar 的 `actions` 字段 |
| `server/internal/assets/detect.go` | `inspect` 透传 `Actions` |
| 测试 | `live2d/__test__/motionScheduler.test.ts`（新）、`live2d/__test__/capabilities.test.ts`（新）、`live2d/__test__/actions.test.ts`（新）、`motionMap.test.ts`（Task 6 删 pickMotion 段）、`server/internal/assets/detect_test.go`、`server/internal/server/server_test.go` |
| `docs/model-setup.md` | Task 5 文档化 `actions` 字段格式 |

---

### Task 1: 动作调度器核心（优先级/冷却/空闲循环）

**Files:**
- Create: `apps/desktop/src/renderer/src/live2d/motionScheduler.ts`
- Test: `apps/desktop/src/renderer/src/live2d/__test__/motionScheduler.test.ts`

**Interfaces:**
- Produces（后续任务依赖）:
  - `P_IDLE = 1`、`P_NORMAL = 2`、`P_FORCE = 3`（与库 MotionPriority 数值一致，调度器不 import 库）
  - `ResolvedAction { group: string | null; index: number | undefined; expression: string | null }`
  - `MotionPlayer { playMotion(group, priority, opts?): Promise<boolean>; playExpression(name): Promise<void>; resetExpression(): Promise<void> }`（playMotion 以真实播完结算：true 播完 / false 库内拒绝启动 / reject 加载失败）
  - `createMotionScheduler(pick: (intent: MotionIntent) => ResolvedAction | null, player: MotionPlayer): MotionScheduler`
  - `MotionScheduler { play(intent, priority?): Promise<boolean>; notifyInteraction(): void; destroy(): void }`
  - `play()` 语义：**派发即 resolve**（不等动作播完），true = 已开始播放/已设置表情；false = 未播放（无匹配/冷却中/被更高优先级拒绝）。旧 playIntent 语义是「播完才 resolve」，但所有调用方都是 fire-and-forget，不影响。

**设计要点（写进模块注释）：** Live2D 库低优先级动作会被高优先级静默忽略（promise 照常 resolve），所以调度器自己记账 `currentPriority`，派发前拒绝并返回真实结果。idle 由单一可重武装定时器驱动：任何互动（非 idle 意图的 play / notifyInteraction）都会重置它；动作播放期间定时器始终处于清除态（settle 时才重新武装）。`playMotion` 的 promise 以**真实播完**结算（库的 motion promise 起播即 resolve，播完由播放器包装 motionFinish 事件表达，见 Task 3）；被抢占的旧动作不产生自己的播完信号，其结算监听随下一次播完幂等落地，因此不需要世代守卫。组合表情由动作结算复位（`motionExpr` 标志），纯表情 hold 由自身定时器复位。

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/src/renderer/src/live2d/__test__/motionScheduler.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMotionScheduler,
  P_IDLE,
  P_NORMAL,
  P_FORCE,
  type MotionPlayer,
  type ResolvedAction
} from '../motionScheduler'

function pending(): { promise: Promise<boolean>; resolve: (v?: boolean) => void; reject: (e: Error) => void } {
  let resolve!: (v?: boolean) => void
  let reject!: (e: Error) => void
  const promise = new Promise<boolean>((res, rej) => {
    resolve = (v = true) => res(v)
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 假播放器：记录每次 playMotion 的组/优先级/选项与 playExpression 的表情名；
 *  playMotion 的 promise 以真实播完结算（resolve）/未启动（resolve(false)）/失败（reject），
 *  由测试手动触发 */
function fakePlayer() {
  const calls: { group: string; priority: number; opts?: { index?: number } }[] = []
  const expressions: string[] = []
  const resets = vi.fn(() => Promise.resolve())
  const motions: { resolve: (v?: boolean) => void; reject: (e: Error) => void }[] = []
  const player: MotionPlayer = {
    playMotion(group, priority, opts) {
      const p = pending()
      // 只在 opts 带实际取值时记录：空 opts 对象不会被 toEqual 当作缺失字段忽略
      const meaningful = opts && opts.index !== undefined
      calls.push(meaningful ? { group, priority, opts } : { group, priority })
      motions.push(p)
      return p.promise
    },
    playExpression(name) {
      expressions.push(name)
      return Promise.resolve()
    },
    resetExpression: resets
  }
  return { calls, expressions, resets, motions, player }
}

/** 只关心表情的假播放器：playMotion 永不结算（纯表情用例不关心动作） */
function voidPlayer(reset: () => Promise<void> = () => Promise.resolve()): MotionPlayer {
  return {
    playMotion: () => new Promise<boolean>(() => {}),
    playExpression: () => Promise.resolve(),
    resetExpression: reset
  }
}

const TAP: ResolvedAction = { group: 'Tap', index: undefined, expression: null }
const IDLE_ACT: ResolvedAction = { group: 'Idle', index: undefined, expression: null }

/** 默认 pick：tap→Tap、idle→Idle、其余 null */
function makePick() {
  return vi.fn((intent: string): ResolvedAction | null => {
    if (intent === 'idle') return IDLE_ACT
    if (intent === 'tap') return TAP
    return null
  })
}

describe('createMotionScheduler', () => {
  let sched: ReturnType<typeof createMotionScheduler>
  let f: ReturnType<typeof fakePlayer>
  let pick: ReturnType<typeof makePick>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0) // 空闲间隔固定 6000ms
    f = fakePlayer()
    pick = makePick()
    sched = createMotionScheduler(pick, f.player)
  })

  afterEach(() => {
    sched.destroy()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('互动力图以 NORMAL 优先级播放，待机以 IDLE 优先级播放', async () => {
    expect(await sched.play('tap')).toBe(true)
    expect(f.calls[0]).toEqual({ group: 'Tap', priority: P_NORMAL })
    f.motions[0].resolve() // tap 播完 → 重新武装 idle
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.calls[1]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('低优先级请求不打断高优先级动作，返回 false（真实结果）', async () => {
    await sched.play('tap', P_FORCE)
    expect(await sched.play('idle', P_IDLE)).toBe(false)
    await vi.advanceTimersByTimeAsync(801) // 越过冷却，仍被优先级拒绝
    expect(await sched.play('tap', P_NORMAL)).toBe(false)
    expect(f.calls).toHaveLength(1)
  })

  it('高优先级抢占低优先级：被抢占动作的结算随下一次播完幂等落地', async () => {
    await sched.play('idle', P_IDLE)
    await sched.play('tap', P_NORMAL) // 抢占（库内 idle 被移出队列，不产生自己的播完信号）
    expect(await sched.play('idle', P_IDLE)).toBe(false) // tap 在播
    f.motions[1].resolve() // tap 播完：库内同一 motionFinish 同时触发两个结算监听
    f.motions[0].resolve() // 被抢占 idle 的结算随之落地
    await vi.advanceTimersByTimeAsync(0) // 让结算回调的微任务落地
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.calls[2]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('动作执行期间 idle 定时器不触发', async () => {
    await sched.play('tap')
    await vi.advanceTimersByTimeAsync(60000) // tap 未结算，idle 不得触发
    expect(f.calls).toHaveLength(1)
  })

  it('互动结束 6s 后 idle（random=0）', async () => {
    await sched.play('tap')
    f.motions[0].resolve()
    await vi.advanceTimersByTimeAsync(5999)
    expect(f.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(f.calls[1]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('idle 播完歇 6-14s 再续（random=1 → 14000ms）', async () => {
    await sched.play('idle', P_IDLE)
    vi.mocked(Math.random).mockReturnValue(1)
    f.motions[0].resolve()
    await vi.advanceTimersByTimeAsync(13999)
    expect(f.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(f.calls[1]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('play 重置空闲计时：互动后从零起算', async () => {
    await sched.play('tap')
    f.motions[0].resolve()
    await vi.advanceTimersByTimeAsync(5000)
    await sched.play('tap') // 第二次互动重置计时
    f.motions[1].resolve()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.calls.filter((c) => c.group === 'Idle')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.calls.filter((c) => c.group === 'Idle')).toHaveLength(1)
  })

  it('notifyInteraction 重置空闲计时', async () => {
    await sched.play('tap')
    f.motions[0].resolve()
    await vi.advanceTimersByTimeAsync(5000)
    sched.notifyInteraction()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.calls.filter((c) => c.group === 'Idle')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.calls.filter((c) => c.group === 'Idle')).toHaveLength(1)
  })

  it('同意图 800ms 冷却：冷却内重复 play 返回 false 不重复播放', async () => {
    expect(await sched.play('tap')).toBe(true)
    f.motions[0].resolve()
    expect(await sched.play('tap')).toBe(false)
    expect(f.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(801)
    expect(await sched.play('tap')).toBe(true)
    expect(f.calls).toHaveLength(2)
  })

  it('无匹配意图返回 false，随后照常进入 idle 循环', async () => {
    expect(await sched.play('greet')).toBe(false)
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.calls[0]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('idle 无匹配时按 10s 重试间隔重排', async () => {
    pick.mockReturnValueOnce(null)
    await sched.play('idle', P_IDLE)
    await vi.advanceTimersByTimeAsync(10000)
    expect(f.calls[0]).toEqual({ group: 'Idle', priority: P_IDLE }) // 重试成功
  })

  it('动作播放失败（player reject）不影响后续调度', async () => {
    expect(await sched.play('tap')).toBe(true)
    f.motions[0].reject(new Error('boom'))
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.calls[1]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('destroy 后不再播放、不再定时', async () => {
    sched.destroy()
    expect(await sched.play('tap')).toBe(false)
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.calls).toHaveLength(0)
  })

  it('动作在途时播纯表情：结算后 idle 照常恢复', async () => {
    expect(await sched.play('tap')).toBe(true)
    pick.mockReturnValueOnce({ group: null, index: undefined, expression: 'F_FUN' })
    expect(await sched.play('happy')).toBe(true)
    f.motions[0].resolve() // tap 结算：纯表情不占优先级、不阻止结算
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.calls[1]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('动作无表情无 hold：结算不复位', async () => {
    expect(await sched.play('tap')).toBe(true)
    f.motions[0].resolve()
    await vi.advanceTimersByTimeAsync(0) // 让结算回调的微任务落地
    expect(f.resets).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.resets).not.toHaveBeenCalled()
  })

  it('空解析（无动作无表情）按无匹配处理：idle 按重试间隔重排', async () => {
    pick.mockReturnValueOnce({ group: null, index: undefined, expression: null })
    expect(await sched.play('idle', P_IDLE)).toBe(false)
    await vi.advanceTimersByTimeAsync(10000)
    expect(f.calls[0]).toEqual({ group: 'Idle', priority: P_IDLE }) // 重试成功
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/motionScheduler.test.ts`
Expected: FAIL——`Cannot find module '../motionScheduler'`

- [ ] **Step 3: 写最小实现**

```ts
// apps/desktop/src/renderer/src/live2d/motionScheduler.ts
// 动作调度器：模型动作的优先级、冷却与空闲循环的单一事实来源（纯逻辑，可 fake timer 测试）。
// 设计要点：
// - 库优先级数值 1=idle、2=normal、3=force；低优先级动作会被高优先级静默忽略
//   （库不保证请求实际生效），所以调度器自己记账 currentPriority，派发前拒绝并返回
//   false——play 的结果是「是否真的开始播放」。
// - playMotion 的 promise 以「真实播完」结算（true），未启动（被库优先级/占用拒绝）
//   结算 false，加载失败 reject；库的 motion promise 在动作开始即 resolve，播完由
//   播放器包装 motionFinish 事件表达（见 model.ts）。
// - 库内被抢占的旧动作不产生自己的播完信号，其结算监听随下一次播完一起落地，
//   因此结算回调不查世代号：每次结算都发生在「当前在播动作已播完」，重复落地幂等。
// - idle 由单一可重武装定时器驱动：任何互动（非 idle 意图的 play / notifyInteraction）
//   都会重置它；动作派发时清除、结算时重新武装——即使定时器在动作期间触发，
//   在途的 idle 请求也会被优先级拒绝，动作不会被待机打断。
// - 表情所有权：组合表情随动作派发显式播放、结算时复位（motionExpr 标志）；
//   纯表情 hold 由自己的定时器复位，动作结算不抢（hold 拥有当前表情）。
import { type MotionIntent } from './motionMap'

export const P_IDLE = 1
export const P_NORMAL = 2
export const P_FORCE = 3

export const IDLE_MIN_MS = 6000
export const IDLE_MAX_MS = 14000
export const IDLE_RETRY_MS = 10000
export const COOLDOWN_MS = 800
export const EXPR_HOLD_MS = 3000

/** 意图解析结果：group=null 表示纯表情（无动作可播） */
export interface ResolvedAction {
  group: string | null
  index: number | undefined
  expression: string | null
}

/** 播放器抽象：model.ts 用真实模型实现，测试用假桩 */
export interface MotionPlayer {
  /** 播动作：promise 在真实播完时结算 true；库内拒绝启动结算 false；加载失败 reject */
  playMotion(group: string, priority: number, opts?: { index?: number }): Promise<boolean>
  playExpression(name: string): Promise<void>
  resetExpression(): Promise<void>
}

export interface MotionScheduler {
  /** 按意图播动作/表情；派发即 resolve，true = 已开始播放/已设置表情 */
  play(intent: MotionIntent, priority?: number): Promise<boolean>
  /** 用户交互（未触发动作的点击）重置空闲计时 */
  notifyInteraction(): void
  destroy(): void
}

export function createMotionScheduler(
  pick: (intent: MotionIntent) => ResolvedAction | null,
  player: MotionPlayer
): MotionScheduler {
  let disposed = false
  let currentPriority = 0
  let idleTimer: number | undefined
  let exprTimer: number | undefined
  /** 在途动作是否持有组合表情（结算时复位；纯表情 hold 不持有） */
  let motionExpr = false
  const lastPlayAt = new Map<MotionIntent, number>()

  function clearIdle(): void {
    if (idleTimer !== undefined) {
      window.clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }

  function clearExpr(): void {
    if (exprTimer !== undefined) {
      window.clearTimeout(exprTimer)
      exprTimer = undefined
    }
  }

  /** 武装空闲定时器（幂等：先清旧timer再武装；默认随机 6-14s） */
  function armIdle(delay = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS)): void {
    if (disposed) return
    clearIdle()
    idleTimer = window.setTimeout(() => void play('idle', P_IDLE), delay)
  }

  async function play(intent: MotionIntent, priority = P_NORMAL): Promise<boolean> {
    if (disposed) return false
    // 同意图最短冷却：连续点击不重复完整播放（idle 由定时器控制，不走冷却）
    const last = lastPlayAt.get(intent) ?? -Infinity
    if (intent !== 'idle' && Date.now() - last < COOLDOWN_MS) return false
    const resolved = pick(intent)
    if (resolved && resolved.group === null && resolved.expression !== null) {
      // 纯表情：不占动作优先级（可与 idle 动作并存），保持 EXPR_HOLD_MS 后复位；
      // hold 拥有当前表情（motionExpr 置 false），在途动作结算不再复位
      lastPlayAt.set(intent, Date.now())
      armIdle()
      motionExpr = false
      void player.playExpression(resolved.expression).catch(() => {})
      clearExpr()
      exprTimer = window.setTimeout(() => {
        if (disposed) return
        exprTimer = undefined // 复位后 hold 不在途，状态与事实一致
        void player.resetExpression().catch(() => {})
      }, EXPR_HOLD_MS)
      return true
    }
    // 无匹配或空解析（无动作无表情）：idle 按重试间隔重排，其余意图武装常规空闲计时
    if (!resolved || resolved.group === null) {
      if (intent === 'idle') armIdle(IDLE_RETRY_MS)
      else armIdle()
      return false
    }
    if (priority < currentPriority) {
      // 高优先级动作在播：库会静默忽略本次请求，提前拒绝返回真实结果。
      // idle 被拒时不武装（在途动作结算时统一武装），其余意图武装常规空闲计时
      if (intent !== 'idle') armIdle()
      return false
    }
    lastPlayAt.set(intent, Date.now())
    clearIdle()
    // 组合表情必须走显式 playExpression：fork 默认 preserveExpressionOnMotion，
    // motion 选项里的 expression 被门控静默丢弃（resetExpression 选项同样无效）
    const expr = resolved.expression
    const heldFace = exprTimer !== undefined // 派发时在途的 hold 会被 clearExpr 取消
    clearExpr()
    if (expr) {
      motionExpr = true
      void player.playExpression(expr).catch(() => {})
    } else if (motionExpr || heldFace) {
      // 新动作不带表情：派发时清掉上一动作的组合表情或被取消 hold 的残留，
      // 否则旧表情会一直挂到下一次复位（抢占/同优先级场景）
      motionExpr = false
      void player.resetExpression().catch(() => {})
    } else {
      motionExpr = false
    }
    currentPriority = priority
    void player
      .playMotion(resolved.group, priority, { index: resolved.index })
      .then((finished) => {
        if (disposed) return
        if (!finished) {
          // 库内拒绝启动（在播动作同/更高优先级）：不动 currentPriority——
          // 在播动作的结算会清零并武装 idle，这里只保证 idle 循环不熄灭
          armIdle(intent === 'idle' ? IDLE_RETRY_MS : undefined)
          return
        }
        currentPriority = 0
        // 组合表情在结算时复位；期间有新的纯表情 hold 在途则留给 hold 回调复位
        if (motionExpr && exprTimer === undefined) void player.resetExpression().catch(() => {})
        motionExpr = false
        armIdle()
      })
      .catch(() => {
        // 加载失败（动作从未播出）：与正常结算同样收敛——表情复位、优先级清零
        if (disposed) return
        currentPriority = 0
        if (motionExpr && exprTimer === undefined) void player.resetExpression().catch(() => {})
        motionExpr = false
        armIdle()
      })
    return true
  }

  return {
    play,
    notifyInteraction() {
      armIdle()
    },
    destroy() {
      disposed = true
      clearIdle()
      clearExpr()
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/motionScheduler.test.ts`
Expected: 16 个用例全部 PASS

- [ ] **Step 5: 格式化并提交**

```bash
cd apps/desktop && pnpm format:check
git add apps/desktop/src/renderer/src/live2d/motionScheduler.ts apps/desktop/src/renderer/src/live2d/__test__/motionScheduler.test.ts
git commit -m "feat(live2d): 新增动作调度器（优先级/冷却/空闲循环纯逻辑模块）"
```

---

### Task 2: 表情组合与纯表情播放（调度器扩展）

**Files:**
- Modify: `apps/desktop/src/renderer/src/live2d/motionScheduler.ts`
- Test: `apps/desktop/src/renderer/src/live2d/__test__/motionScheduler.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `createMotionScheduler`/`MotionPlayer`/`ResolvedAction`
- Produces: 纯表情 hold/复位行为（Task 3 接线依赖）；组合表情经 playExpression 显式播放、结算复位（最终评审修正后）

**要点：** Task 1 的实现已含表情分支（为保持两个任务各自可测，Task 1 的测试未覆盖表情）。本任务只补测试：若实现有缺口（如 hold 定时器未清、派发时残留表情未清除）按失败信息修正，预期实现无需大改。

- [ ] **Step 1: 追加失败测试**

在 `motionScheduler.test.ts` 的 describe 内追加（fakePlayer 扩展记录 opts/expressions/resets 与 voidPlayer 助手已并入 Task 1 测试文件头部）：

```ts
  it('动作+表情：动作经 playMotion 播放，表情经 playExpression 显式播放，结算后复位', async () => {
    pick.mockReturnValue({ group: 'Tap', index: 4, expression: 'F_FUN' })
    expect(await sched.play('happy')).toBe(true)
    expect(f.calls[0]).toEqual({ group: 'Tap', priority: P_NORMAL, opts: { index: 4 } })
    expect(f.expressions).toEqual(['F_FUN'])
    expect(f.resets).not.toHaveBeenCalled()
    f.motions[0].resolve()
    await vi.advanceTimersByTimeAsync(0) // 让结算回调的微任务落地
    expect(f.resets).toHaveBeenCalledTimes(1)
  })

  it('动作无表情但派发时旧 hold 在途：派发时清除残留表情，结算不重复复位', async () => {
    pick.mockReturnValueOnce({ group: null, index: undefined, expression: 'F_FUN' })
    expect(await sched.play('happy')).toBe(true) // 纯表情，hold 计时开始
    expect(await sched.play('tap')).toBe(true) // TAP 无表情，hold 被取消、残留表情派发时清除
    expect(f.resets).toHaveBeenCalledTimes(1) // 派发时清除残留
    f.motions[0].resolve()
    await vi.advanceTimersByTimeAsync(0) // 让结算回调的微任务落地
    expect(f.resets).toHaveBeenCalledTimes(1) // 结算不重复复位
    await vi.advanceTimersByTimeAsync(3001)
    expect(f.resets).toHaveBeenCalledTimes(1) // 旧 hold 定时器确实已取消
  })

  it('组合动作在途时新纯表情 hold：结算不复位，由 hold 复位', async () => {
    pick.mockReturnValue({ group: 'Tap', index: undefined, expression: 'F_FUN' })
    expect(await sched.play('happy')).toBe(true)
    pick.mockReturnValueOnce({ group: null, index: undefined, expression: 'F_SURPRISE' })
    expect(await sched.play('surprised')).toBe(true) // 动作在途，新 hold
    f.motions[0].resolve()
    await vi.advanceTimersByTimeAsync(0) // 让结算回调的微任务落地
    expect(f.resets).not.toHaveBeenCalled() // hold 拥有当前表情，结算不抢复位
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.resets).toHaveBeenCalledTimes(1)
  })

  it('纯表情：播放表情并保持 3s 后复位', async () => {
    pick.mockReturnValue({ group: null, index: undefined, expression: 'F_FUN' })
    const expr = vi.fn(() => Promise.resolve())
    const reset = vi.fn(() => Promise.resolve())
    sched = createMotionScheduler(pick, {
      playMotion: () => new Promise(() => {}),
      playExpression: expr,
      resetExpression: reset
    })
    expect(await sched.play('happy')).toBe(true)
    expect(expr).toHaveBeenCalledWith('F_FUN')
    await vi.advanceTimersByTimeAsync(2999)
    expect(reset).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('纯表情不占动作优先级：期间最低优先级的 idle 照常播放', async () => {
    pick.mockReturnValueOnce({ group: null, index: undefined, expression: 'F_FUN' })
    expect(await sched.play('happy')).toBe(true) // 纯表情
    expect(await sched.play('idle', P_IDLE)).toBe(true) // idle 未被拒 → 证明未占用优先级
    expect(f.calls[0]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('hold 期间新动作触发：旧 hold 失效不复位', async () => {
    pick.mockReturnValueOnce({ group: null, index: undefined, expression: 'F_FUN' })
    const reset = vi.fn(() => Promise.resolve())
    sched = createMotionScheduler(pick, voidPlayer(reset))
    await sched.play('happy') // 纯表情，hold 计时开始
    pick.mockReturnValue({ group: 'Tap', index: undefined, expression: 'F_SAD' })
    await sched.play('sad') // 新动作，旧 hold 被取消
    await vi.advanceTimersByTimeAsync(3001)
    expect(reset).not.toHaveBeenCalled()
  })

  it('destroy 清除 hold 定时器', async () => {
    pick.mockReturnValue({ group: null, index: undefined, expression: 'F_FUN' })
    const reset = vi.fn(() => Promise.resolve())
    sched = createMotionScheduler(pick, voidPlayer(reset))
    await sched.play('happy')
    sched.destroy()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(3001)
    expect(reset).not.toHaveBeenCalled()
  })

  it('库内拒绝启动（结算 false）：不动在播动作的优先级，播完仍恢复 idle', async () => {
    expect(await sched.play('tap')).toBe(true) // 动作 A 在播
    await vi.advanceTimersByTimeAsync(801) // 越过冷却
    expect(await sched.play('tap')).toBe(true) // 动作 B 派发（库内同优先级被拒）
    f.motions[1].resolve(false) // B 未启动
    await vi.advanceTimersByTimeAsync(0) // 让结算回调的微任务落地
    expect(await sched.play('idle', P_IDLE)).toBe(false) // A 仍在播，B 的结算不得清零
    f.motions[0].resolve() // A 播完 → 恢复
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.calls[2]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('抢占动作不带表情：派发时清除上一动作的组合表情，结算不再重复复位', async () => {
    pick.mockReturnValue({ group: 'Tap', index: undefined, expression: 'F_FUN' })
    expect(await sched.play('happy')).toBe(true) // 组合动作在播
    pick.mockReturnValue({ group: 'Tap', index: undefined, expression: null })
    expect(await sched.play('tap', P_FORCE)).toBe(true) // 抢占，不带表情
    expect(f.resets).toHaveBeenCalledTimes(1) // 派发时清除旧组合表情
    f.motions[1].resolve() // 新动作播完
    await vi.advanceTimersByTimeAsync(0) // 让结算回调的微任务落地
    expect(f.resets).toHaveBeenCalledTimes(1) // 结算不再重复复位
  })

  it('hold 到期复位后不再视为在途：后续无表情动作不重复复位', async () => {
    pick.mockReturnValueOnce({ group: null, index: undefined, expression: 'F_FUN' })
    expect(await sched.play('happy')).toBe(true) // 纯表情 hold
    await vi.advanceTimersByTimeAsync(3001) // hold 到期复位
    expect(f.resets).toHaveBeenCalledTimes(1)
    pick.mockReturnValue({ group: 'Tap', index: undefined, expression: null })
    expect(await sched.play('tap', P_FORCE)).toBe(true) // 无表情动作
    expect(f.resets).toHaveBeenCalledTimes(1) // 不复位：hold 已结束
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/motionScheduler.test.ts`
Expected: 表情相关用例 FAIL（fakePlayer 未记录 opts）或部分 PASS（若 Task 1 实现已覆盖）

- [ ] **Step 3: 修正实现使测试通过**

- `fakePlayer` 的 `playMotion` 改为 `(group, priority, opts)`：仅当 `opts.index` 有定义时记录 `opts`（实现总是传 opts 对象，全 undefined 的 opts 会被 toEqual 比较，误伤既有断言）。
- 若实现与 Task 1 代码一致则全部直接 PASS；若「旧 hold 失效不复位」用例失败，检查动作派发路径是否调用 `clearExpr()`；若「派发时清除残留表情」类用例失败，检查派发分支是否在 `heldFace` 采样后、新动作不带表情时立即 `resetExpression()`，按 Task 1 代码对齐。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/motionScheduler.test.ts`
Expected: 26 个用例全部 PASS

- [ ] **Step 5: 提交**

```bash
cd apps/desktop && pnpm format:check
git add apps/desktop/src/renderer/src/live2d/__test__/motionScheduler.test.ts apps/desktop/src/renderer/src/live2d/motionScheduler.ts
git commit -m "test(live2d): 覆盖表情组合与纯表情 hold/复位调度行为"
```

---

### Task 3: model.ts 接入调度器（替换内联 idle 循环）

**Files:**
- Modify: `apps/desktop/src/renderer/src/live2d/model.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `createMotionScheduler`、`P_NORMAL`、`MotionPlayer`；既有 `pickMotion(intent, groups)`（组匹配 + idle 兜底）做临时适配器，Task 6 换成 `resolveAction`
- Produces: `PetModel.playIntent` 行为修正（优先级/空闲/真实结果）；`loadPetModel` 签名不变（Task 6 加 actions 参数）

**改动点（当前文件行号参照 Task 执行时）：**
1. import 区（第 6 行附近）加：
   ```ts
   import { createMotionScheduler, P_NORMAL, type MotionPlayer } from './motionScheduler'
   ```
2. `createPetModel` 内 `const groups = motionGroups(model)` 之后加调度器与播放器：
   ```ts
   const groups = motionGroups(model)
   const player: MotionPlayer = {
     playMotion(group, priority, opts) {
       // 类型声明未暴露 EventEmitter 的 once（运行时 MotionManager 继承 PIXI EventEmitter）
       const mm = model.internalModel.motionManager as unknown as {
         once(event: 'motionFinish', cb: () => void): void
       }
       return model.motion(group, opts?.index, priority).then((started) => {
         // 库的 motion promise 在动作开始即 resolve（不是播完）；真实播完是 motionFinish
         // 事件。被抢占的旧动作不触发自己的 motionFinish，其 once 监听随下一次播完
         // 一起落地（调度器结算幂等，见 motionScheduler 头注释）。
         if (!started) return false
         return new Promise<boolean>((resolve) => {
           mm.once('motionFinish', () => resolve(true))
         })
       })
     },
     playExpression(name) {
       return model.expression(name).then(() => {})
     },
     resetExpression() {
       // 无参 expression() 在 fork 是随机表情（setRandomExpression），复位必须走 expressionManager
       model.internalModel.motionManager.expressionManager?.resetExpression()
       return Promise.resolve()
     }
   }
   }
   const scheduler = createMotionScheduler(
     // 临时适配器：Task 6 换成能力目录 + resolveAction 五层降级
     (intent) => {
       const group = pickMotion(intent, groups)
       return group ? { group, index: undefined, expression: null } : null
     },
     player
   )
   ```
3. `playIntent`（第 190-198 行）改为：
   ```ts
   playIntent(intent: MotionIntent, priority?: number) {
     if (disposed) return Promise.resolve(false)
     return scheduler.play(intent, priority ?? P_NORMAL)
   },
   ```
4. 删除内联 idle 循环（第 215-233 行：`let idleTimer = window.setTimeout(startIdle, 2000)`、`void facade.playIntent('greet')`、整个 `startIdle` 函数），替换为：
   ```ts
   void scheduler.play('greet') // 问候动作；无问候组的模型走 pickMotion 的 idle 兜底
   ```
5. `destroy()`（第 199 行起）里 `window.clearTimeout(idleTimer)` 替换为 `scheduler.destroy()`。

- [ ] **Step 1: 改造 model.ts（上述 5 处）**

无新增单测：调度行为已由 Task 1/2 覆盖，本任务是接线。改完后：

- [ ] **Step 2: 跑既有测试 + 类型检查**

Run:
```bash
cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/ && pnpm typecheck
```
Expected: 全部 PASS（`motionMap.test.ts` 仍测旧 pickMotion，不受影响）

- [ ] **Step 3: 提交**

```bash
cd apps/desktop && pnpm format:check
git add apps/desktop/src/renderer/src/live2d/model.ts
git commit -m "fix(live2d): 动作调度接入调度器（优先级修正、互动重置空闲、真实播放结果）"
```

---

### Task 4: 模型能力目录与五层降级解析器

**Files:**
- Create: `apps/desktop/src/renderer/src/live2d/capabilities.ts`
- Create: `apps/desktop/src/renderer/src/live2d/actions.ts`
- Test: `apps/desktop/src/renderer/src/live2d/__test__/capabilities.test.ts`
- Test: `apps/desktop/src/renderer/src/live2d/__test__/actions.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ResolvedAction`（从 `./motionScheduler` import 类型）；`motionMap` 的 `INTENT_MOTIONS`、`MotionIntent`
- Produces:
  - `ModelCapabilities { motions: Record<string, number>; expressions: string[] }`
  - `deriveCapabilities(model: Live2DModel): ModelCapabilities`
  - `AvatarActionSpec { motion?: string; motionIndex?: number; expression?: string }`
  - `AvatarActions = Partial<Record<MotionIntent, AvatarActionSpec>>`
  - `resolveAction(intent, caps, actions?): ResolvedAction | null`

**降级链（写进 actions.ts 注释）：** ① avatar.json 手工映射（引用的组/表情必须真实存在，否则整条失效）；② 内置动作组（INTENT_MOTIONS 候选）+ 表情名规则组合；③ 只播匹配表情；④ 通用反应动作（优先 Tap，否则第一个非 idle 组）；⑤ idle 组兜底。greet/idle 跳过 ③④（问候与待机保持动作语义）。

- [ ] **Step 1: 写失败测试（两个文件）**

```ts
// apps/desktop/src/renderer/src/live2d/__test__/capabilities.test.ts
import { describe, expect, it } from 'vitest'
import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch'
import { deriveCapabilities } from '../capabilities'

function fakeModel(settings: object, definitions: Record<string, unknown[]>): Live2DModel {
  return { internalModel: { motionManager: { definitions }, settings } } as unknown as Live2DModel
}

describe('deriveCapabilities', () => {
  it('汇总动作组数与表情名（cubism4 大写 Name）', () => {
    const caps = deriveCapabilities(
      fakeModel({ expressions: [{ Name: 'F_FUN' }, { Name: 'F_SAD' }] }, { Idle: [1, 2, 3], Tap: [1] })
    )
    expect(caps).toEqual({ motions: { Idle: 3, Tap: 1 }, expressions: ['F_FUN', 'F_SAD'] })
  })

  it('cubism2 小写 name 同样可读', () => {
    const caps = deriveCapabilities(fakeModel({ expressions: [{ name: 'f01' }, { name: 'f02' }] }, {}))
    expect(caps.expressions).toEqual(['f01', 'f02'])
  })

  it('无表情字段 → 空数组', () => {
    expect(deriveCapabilities(fakeModel({}, { Idle: [1] }))).toEqual({ motions: { Idle: 1 }, expressions: [] })
  })
})
```

```ts
// apps/desktop/src/renderer/src/live2d/__test__/actions.test.ts
import { describe, expect, it } from 'vitest'
import { resolveAction, type AvatarActions } from '../actions'
import { type ModelCapabilities } from '../capabilities'

// 三套与真实模型同构的夹具：haru（官方免费，只有 Idle/Tap + 单词表情）、
// shizuku（cubism2，tap_body/shake + 编号表情）、katou 类（语义化表情 F_*）
const haru: ModelCapabilities = {
  motions: { Idle: 3, Tap: 5 },
  expressions: ['Angry', 'Happy', 'Surprised']
}
const shizuku: ModelCapabilities = {
  motions: { idle: 2, tap_body: 4, shake: 1 },
  expressions: ['f01', 'f02', 'smile']
}
const katou: ModelCapabilities = {
  motions: { Idle: 2, Tap: 23, talk: 3 },
  expressions: ['F_FUN', 'F_SAD', 'F_ANGRY', 'F_SURPRISE', 'F_SLEEPY']
}

describe('resolveAction', () => {
  it('haru：tap 命中 Tap 组；happy 无组按表情规则命中 Happy（纯表情）', () => {
    expect(resolveAction('tap', haru)).toEqual({ group: 'Tap', index: undefined, expression: null })
    expect(resolveAction('happy', haru)).toEqual({ group: null, index: undefined, expression: 'Happy' })
  })

  it('haru：sad 无组无表情规则 → 通用 Tap 兜底', () => {
    expect(resolveAction('sad', haru)).toEqual({ group: 'Tap', index: undefined, expression: null })
  })

  it('shizuku：tap 命中 tap_body；smile 按规则命中 happy；sad 走通用动作', () => {
    expect(resolveAction('tap', shizuku)).toEqual({ group: 'tap_body', index: undefined, expression: null })
    expect(resolveAction('happy', shizuku)).toEqual({ group: null, index: undefined, expression: 'smile' })
    expect(resolveAction('sad', shizuku)).toEqual({ group: 'tap_body', index: undefined, expression: null })
  })

  it('katou：语义化表情逐个命中；thinking 无组无表情 → 通用 Tap', () => {
    expect(resolveAction('happy', katou)).toEqual({ group: null, index: undefined, expression: 'F_FUN' })
    expect(resolveAction('sad', katou)).toEqual({ group: null, index: undefined, expression: 'F_SAD' })
    expect(resolveAction('angry', katou)).toEqual({ group: null, index: undefined, expression: 'F_ANGRY' })
    expect(resolveAction('surprised', katou)).toEqual({ group: null, index: undefined, expression: 'F_SURPRISE' })
    expect(resolveAction('thinking', katou)).toEqual({ group: 'Tap', index: undefined, expression: null })
  })

  it('avatar.json 映射优先：motion+index+expression 组合', () => {
    const actions: AvatarActions = { happy: { motion: 'Tap', motionIndex: 4, expression: 'F_FUN' } }
    expect(resolveAction('happy', katou, actions)).toEqual({ group: 'Tap', index: 4, expression: 'F_FUN' })
  })

  it('映射只配 expression → 纯表情', () => {
    const actions: AvatarActions = { sad: { expression: 'F_SAD' } }
    expect(resolveAction('sad', katou, actions)).toEqual({ group: null, index: undefined, expression: 'F_SAD' })
  })

  it('映射指向不存在的动作组 → 整条失效走内置降级', () => {
    const actions: AvatarActions = { happy: { motion: 'Nope', expression: 'F_FUN' } }
    expect(resolveAction('happy', katou, actions)).toEqual({ group: null, index: undefined, expression: 'F_FUN' })
  })

  it('映射指向不存在的表情 → 整条失效走内置降级', () => {
    const actions: AvatarActions = { happy: { motion: 'Tap', expression: 'NOPE' } }
    expect(resolveAction('happy', katou, actions)).toEqual({ group: null, index: undefined, expression: 'F_FUN' })
  })

  it('greet 无专属组不降级到表情/通用动作，idle 兜底（与旧行为一致）', () => {
    expect(resolveAction('greet', haru)).toEqual({ group: 'Idle', index: undefined, expression: null })
  })

  it('idle 意图：有 idle 组命中；无任何 idle 组返回 null', () => {
    expect(resolveAction('idle', haru)).toEqual({ group: 'Idle', index: undefined, expression: null })
    expect(resolveAction('idle', { motions: { Tap: 3 }, expressions: [] })).toBeNull()
  })

  it('语义组命中时附带表情（组合播放）', () => {
    const caps: ModelCapabilities = { motions: { talk: 3 }, expressions: ['F_SMILE'] }
    expect(resolveAction('speak', caps)).toEqual({ group: 'talk', index: undefined, expression: 'F_SMILE' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/capabilities.test.ts src/renderer/src/live2d/__test__/actions.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 写实现**

```ts
// apps/desktop/src/renderer/src/live2d/capabilities.ts
// 模型能力目录：加载时从模型设定读出「有什么动作组、有什么表情」，
// 供意图解析降级链与 avatar.json 映射校验使用（见 actions.ts）。
import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch'

export interface ModelCapabilities {
  /** 动作组名 → 组内动作数（模型设定文件实际定义的） */
  motions: Record<string, number>
  /** 表情名列表（模型设定文件实际定义的） */
  expressions: string[]
}

export function deriveCapabilities(model: Live2DModel): ModelCapabilities {
  const defs = model.internalModel.motionManager.definitions as Record<string, unknown[]>
  const motions: Record<string, number> = {}
  for (const [group, list] of Object.entries(defs)) motions[group] = list.length
  // cubism4 大写 Name / cubism2 小写 name，两种都读
  const settings = model.internalModel.settings as { expressions?: { Name?: string; name?: string }[] }
  const expressions = (settings.expressions ?? []).map((e) => e.Name ?? e.name ?? '').filter(Boolean)
  return { motions, expressions }
}
```

```ts
// apps/desktop/src/renderer/src/live2d/actions.ts
// 意图 → 具体动作/表情的解析（五层降级）：
// ① avatar.json 手工映射（引用的组/表情必须真实存在，否则整条失效）
// ② 内置动作组（INTENT_MOTIONS 候选）+ 表情名规则，组合播放
// ③ 只播匹配表情（无动作可播的模型至少"变个脸"）
// ④ 通用反应动作：优先 Tap 组，否则第一个非 idle 组
// ⑤ idle 组兜底
// greet/idle 跳过 ③④：问候与待机保持动作语义。
import { INTENT_MOTIONS, type MotionIntent } from './motionMap'
import { type ResolvedAction } from './motionScheduler'
import { type ModelCapabilities } from './capabilities'

export interface AvatarActionSpec {
  /** 动作组名（模型内不存在时整条映射失效） */
  motion?: string
  /** 组内动作下标（缺省 = 库随机） */
  motionIndex?: number
  /** 表情名（模型内不存在时整条映射失效） */
  expression?: string
}

export type AvatarActions = Partial<Record<MotionIntent, AvatarActionSpec>>

// 表情名意图规则：按小写子串匹配，取模型表情序第一个命中。
// 每个意图的词表刻意避开其他意图的高频词，减少误命中；shizuku 的 f01
// 这类编号表情匹配不到任何规则 → 走通用动作降级，属于预期。
const EXPRESSION_RULES: Record<MotionIntent, string[]> = {
  idle: [],
  tap: [],
  greet: [],
  thinking: ['think', 'ponder', 'confus', 'puzzle', 'doubt'],
  speak: ['talk', 'speak', 'shout', 'laugh', 'smile'],
  happy: ['fun', 'happy', 'smile', 'joy', 'laugh', 'grin', 'delight', 'excite', 'cheer'],
  sad: ['sad', 'cry', 'depress', 'gloom', 'sorrow', 'despair'],
  angry: ['anger', 'angry', 'mad', 'annoy', 'pout', 'upset'],
  surprised: ['surpris', 'shock', 'amaze', 'astonish', 'wow'],
  bye: [],
  sleep: ['sleep', 'nap', 'drows', 'yawn', 'closeeye', 'close_eye']
}

export function resolveAction(
  intent: MotionIntent,
  caps: ModelCapabilities,
  actions?: AvatarActions
): ResolvedAction | null {
  const mapped = resolveMapped(intent, caps, actions)
  if (mapped) return mapped
  const group = pickGroup(intent, caps)
  if (group) return { group, index: undefined, expression: pickExpression(intent, caps) }
  if (intent !== 'greet' && intent !== 'idle') {
    const expr = pickExpression(intent, caps)
    if (expr) return { group: null, index: undefined, expression: expr }
    const generic = pickGeneric(caps)
    if (generic) return { group: generic, index: undefined, expression: null }
  }
  const idle = pickGroup('idle', caps)
  return idle ? { group: idle, index: undefined, expression: null } : null
}

/** ① avatar.json 手工映射；引用的组/表情不存在视为「写给别的模型」，整条失效 */
function resolveMapped(
  intent: MotionIntent,
  caps: ModelCapabilities,
  actions?: AvatarActions
): ResolvedAction | null {
  const spec = actions?.[intent]
  if (!spec) return null
  if (spec.motion !== undefined && !Object.prototype.hasOwnProperty.call(caps.motions, spec.motion)) return null
  if (spec.expression !== undefined && !caps.expressions.includes(spec.expression)) return null
  return { group: spec.motion ?? null, index: spec.motionIndex, expression: spec.expression ?? null }
}

/** 内置动作组匹配：INTENT_MOTIONS 候选依次精确/忽略大小写匹配，无匹配返回 null */
function pickGroup(intent: MotionIntent, caps: ModelCapabilities): string | null {
  const candidates = INTENT_MOTIONS[intent] ?? []
  const groups = Object.keys(caps.motions)
  for (const c of candidates) {
    if (groups.includes(c)) return c
  }
  const lower = groups.map((g) => g.toLowerCase())
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase())
    if (idx >= 0) return groups[idx]
  }
  return null
}

/** ④ 通用反应动作：优先 Tap 组；否则第一个非 idle 组（确定性，便于测试） */
function pickGeneric(caps: ModelCapabilities): string | null {
  const tap = pickGroup('tap', caps)
  if (tap) return tap
  const idleLower = INTENT_MOTIONS.idle.map((n) => n.toLowerCase())
  return Object.keys(caps.motions).find((g) => !idleLower.includes(g.toLowerCase())) ?? null
}

/** 表情名规则匹配：取模型表情序第一个命中规则词的表情 */
function pickExpression(intent: MotionIntent, caps: ModelCapabilities): string | null {
  const words = EXPRESSION_RULES[intent] ?? []
  if (words.length === 0) return null
  for (const name of caps.expressions) {
    const low = name.toLowerCase()
    if (words.some((w) => low.includes(w))) return name
  }
  return null
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/live2d/__test__/capabilities.test.ts src/renderer/src/live2d/__test__/actions.test.ts && pnpm typecheck`
Expected: 14 个用例全部 PASS（capabilities 3 + actions 11）；typecheck 无错误

- [ ] **Step 5: 提交**

```bash
cd apps/desktop && pnpm format:check
git add apps/desktop/src/renderer/src/live2d/capabilities.ts apps/desktop/src/renderer/src/live2d/actions.ts apps/desktop/src/renderer/src/live2d/__test__/capabilities.test.ts apps/desktop/src/renderer/src/live2d/__test__/actions.test.ts
git commit -m "feat(live2d): 模型能力目录与意图五层降级解析（表情规则+通用动作兜底）"
```

---

### Task 5: 服务端 avatar.json `actions` 字段解析透传

**Files:**
- Modify: `server/internal/assets/avatar.go`
- Modify: `server/internal/assets/detect.go`
- Test: `server/internal/assets/detect_test.go`
- Test: `server/internal/server/server_test.go`
- Docs: `docs/model-setup.md`

**Interfaces:**
- Consumes: 无
- Produces: API `/api/v1/assets` 响应中 `avatar.actions` 字段（`{"<意图>":{"motion":...,"motionIndex":...,"expression":...}}`，全部可选）；Task 6 前端消费

**要点：** 服务端只透传不校验——引用的动作组/表情是否存在由前端按真实能力目录降级（Task 4）。`motionIndex` 用 `*int` 区分未配置与 0。

- [ ] **Step 1: 写失败测试**

`detect_test.go` 的 haru fixture 加 actions（第 26-27 行）：

```go
"haru/avatar.json": `{"name":"Haru","author":"Live2D","version":"1.0","license":"free","homepage":"https://example.com","persona":"persona/haru.txt","actions":{"happy":{"motion":"Tap","motionIndex":4,"expression":"F_FUN"},"sad":{"expression":"F_SAD"}}}`,
```

`TestDetect` 的 haru 断言区（`got[0].Expressions != 2` 之后）追加：

```go
if got[0].Actions["happy"].Motion != "Tap" || got[0].Actions["happy"].MotionIndex == nil ||
	*got[0].Actions["happy"].MotionIndex != 4 || got[0].Actions["happy"].Expression != "F_FUN" {
	t.Fatalf("haru Actions.happy 不符: %+v", got[0].Actions)
}
if got[0].Actions["sad"].Expression != "F_SAD" || got[0].Actions["sad"].MotionIndex != nil {
	t.Fatalf("haru Actions.sad 不符: %+v", got[0].Actions)
}
```

shizuku 断言区（`got[2].Expressions != 1` 之后）追加：

```go
if got[2].Actions != nil {
	t.Fatalf("无 avatar.json 的 shizuku Actions 应为 nil: %+v", got[2].Actions)
}
```

`server_test.go` 的 `makeTestZip`（第 82 行）fixture 改为：

```go
"m/avatar.json":   `{"name":"测试形象","actions":{"sad":{"expression":"F_SAD"}}}`,
```

`TestAssetsImportListDelete` 的导入断言（`av["name"] != "测试形象"` 之后）追加：

```go
act, _ := av["actions"].(map[string]any)
if act == nil || act["sad"].(map[string]any)["expression"] != "F_SAD" {
	t.Fatalf("导入响应应透传 actions: %v", av)
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/assets/ ./internal/server/`
Expected: FAIL——`got[0].Actions` 编译错误（字段不存在）

- [ ] **Step 3: 写实现**

`avatar.go`：`Avatar` 结构体（`Expressions` 字段后）与 `avatarJSON` 结构体各加：

```go
// AvatarActionSpec 是 avatar.json actions 里单条动作映射（全部可选）。
// motion/expression 是否在模型里真实存在由前端按模型能力目录校验（无效走内置降级）。
type AvatarActionSpec struct {
	Motion      string `json:"motion,omitempty"`
	MotionIndex *int   `json:"motionIndex,omitempty"`
	Expression  string `json:"expression,omitempty"`
}
```

```go
Actions map[string]AvatarActionSpec `json:"actions,omitempty"` // 意图 → 动作/表情映射（全部可选）
```

`detect.go` 的 `inspect`（`av.Persona = meta.Persona` 附近）加：

```go
av.Actions = meta.Actions
```

`docs/model-setup.md` 的 avatar.json 字段表加一行，并在表后加示例：

```markdown
| `actions` | 动作映射：`{"<意图>":{"motion":"动作组名","motionIndex":3,"expression":"表情名"}}`，字段全部可选；引用的组/表情需真实存在于模型，否则按内置规则降级 |
```

````markdown
### actions 动作映射

意图可选：`tap` / `greet` / `idle` / `thinking` / `speak` / `happy` / `sad` / `angry` / `surprised` / `bye` / `sleep`。
只配 `expression` 即纯表情（无动作、保持约 3 秒后复位）；`motionIndex` 缺省由程序随机选组内动作。

```json
{
  "actions": {
    "happy": { "motion": "Tap", "motionIndex": 4, "expression": "F_FUN" },
    "sad": { "motion": "Tap", "motionIndex": 7, "expression": "F_SAD" }
  }
}
```

没有映射的意图按内置规则降级：动作组名匹配 → 表情名规则 → 通用动作（Tap 优先）→ idle 兜底，
大部分模型不写 actions 也有合理反应。
````

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/assets/ ./internal/server/`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/internal/assets/avatar.go server/internal/assets/detect.go server/internal/assets/detect_test.go server/internal/server/server_test.go docs/model-setup.md
git commit -m "feat(assets): avatar.json 透传 actions 动作映射（不校验，前端按能力目录降级）"
```

---

### Task 6: 前端 actions 数据流 + 解析器接线

**Files:**
- Modify: `apps/desktop/src/renderer/src/env.d.ts`
- Modify: `apps/desktop/src/renderer/src/lib/assetsApi.ts`
- Modify: `apps/desktop/src/renderer/src/store/petStore.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/pet/PetCanvas.tsx`
- Modify: `apps/desktop/src/renderer/src/live2d/model.ts`
- Modify: `apps/desktop/src/renderer/src/live2d/motionMap.ts`（删除 pickMotion）
- Test: `apps/desktop/src/renderer/src/live2d/__test__/motionMap.test.ts`（删 pickMotion 段）

**Interfaces:**
- Consumes: Task 4 的 `deriveCapabilities`/`resolveAction`/`AvatarActions`；Task 5 的 API 字段
- Produces: `loadPetModel(canvas, url, name, actions?)`；`PetModel.playIntent` 走完整降级链；`PetModel.notifyInteraction()`（点击兜底重置空闲计时）

**要点：** `loadPetModel` 的模块级 cache 仍按 url 键控——actions 与 url 一一对应（同一 slug 同一入口），avatar.json 修改后需重启后端/重新加载模型列表才生效（与现有元数据一致）。纯接线任务，无新增单测；解析器行为已由 Task 4 覆盖。

- [ ] **Step 1: env.d.ts 加全局类型**

文件顶部（`declare global` 之前）加 import，`AvatarInfo` 接口尾部加字段：

```ts
import type { AvatarActions } from './live2d/actions'

declare global {
  ...
  interface AvatarInfo extends ModelInfo {
    ...
    /** avatar.json 的动作映射（服务端透传，解析见 live2d/actions.ts） */
    actions?: AvatarActions
  }
```

- [ ] **Step 2: assetsApi 透传**

```ts
import type { AvatarActions } from '../live2d/actions'

interface RawAvatar {
  ...
  actions?: AvatarActions
}
```

`toAvatar` 返回对象加：

```ts
...(a.actions ? { actions: a.actions } : {})
```

- [ ] **Step 3: petStore 记录选中模型的 actions**

顶部 import 区加：

```ts
import type { AvatarActions } from '../live2d/actions'
```

状态接口与初始值加：

```ts
modelActions: AvatarActions | null
```

初始值 `modelActions: null`；四个 set 处同步更新：

```ts
// loadModels
modelActions: next?.actions ?? null,
// selectModel
modelActions: info.actions ?? null,
// importModel
modelActions: avatar.actions ?? null,
// deleteModel
modelActions: kept ? (kept.actions ?? null) : (models[0]?.actions ?? null),
```

- [ ] **Step 4: App / PetCanvas 传参**

App.tsx：

```ts
const modelActions = usePetStore((s) => s.modelActions)
...
<PetCanvas
  url={modelUrl}
  name={modelName ?? ''}
  actions={modelActions}
  ...
/>
```

PetCanvas.tsx：Props 加 `actions: AvatarActions | null`，调用处：

```ts
void loadPetModel(canvas, url, name, actions ?? undefined)
```

effect 依赖保持 `[url, name]` 不变（actions 随 url 变化，见要点）。

点击回调（tap 处理）加 `notifyInteraction()`——点击被冷却/优先级拒绝时也算互动，重置空闲计时（P0：每次点击都重置 idle 倒计时）：

```ts
() => {
  pet.notifyInteraction()
  void pet.playIntent('tap')
},
```

- [ ] **Step 5: model.ts 换解析器并清理**

```ts
import { deriveCapabilities } from './capabilities'
import { resolveAction, type AvatarActions } from './actions'
```

`loadPetModel`/`createPetModel` 加第 4 参 `actions?: AvatarActions`；`createPetModel` 内：

```ts
const caps = deriveCapabilities(model)
const scheduler = createMotionScheduler((intent) => resolveAction(intent, caps, actions), player)
```

删除 `const groups = motionGroups(model)`、临时适配器与 `motionGroups()` 函数、`pickMotion` import。

`PetModel` 接口 `playIntent` 之后加（点击被拒/冷却时也重置空闲）：

```ts
/** 未派发动作的互动也重置空闲计时（点击被冷却/优先级拒时 idle 不立即触发） */
notifyInteraction(): void
```

facade 对象 `playIntent` 之后加：

```ts
notifyInteraction() {
  scheduler.notifyInteraction()
},
```

- [ ] **Step 6: motionMap.ts 删 pickMotion + 更新测试**

`motionMap.ts`：删除 `pickMotion` 函数及其注释（保留 `INTENT_MOTIONS`、`parseMotionTags`、`MotionIntent`）。

`motionMap.test.ts`：删除 `describe('pickMotion', ...)` 整段（其覆盖由 actions.test.ts 承接）。

- [ ] **Step 7: 跑全量前端测试 + 类型检查**

Run: `cd apps/desktop && pnpm vitest run && pnpm typecheck`
Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
cd apps/desktop && pnpm format:check
git add apps/desktop/src/renderer/src/env.d.ts apps/desktop/src/renderer/src/lib/assetsApi.ts apps/desktop/src/renderer/src/store/petStore.ts apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/pet/PetCanvas.tsx apps/desktop/src/renderer/src/live2d/model.ts apps/desktop/src/renderer/src/live2d/motionMap.ts apps/desktop/src/renderer/src/live2d/__test__/motionMap.test.ts
git commit -m "feat(live2d): 接线 avatar.json actions 与能力目录解析（删除旧 pickMotion）"
```

---

### Task 7: 视觉冒烟验收（用户执行，不 commit）

**Files:** 无

**前置：** `make test` 全绿；模型目录里有 haru 与 shizuku（`make assets` 拉取）。

- [ ] **Step 1: 启动开发环境**

Run: `memory_pressure -Q` 确认内存余量后 `make dev`

- [ ] **Step 2: haru（官方，只有 Idle/Tap + Angry/Happy/Surprised 表情）**

- [ ] 加载后先播问候动作，随后 6-14 秒出现待机，无「加载 2 秒就 idle」
- [ ] 点击模型播 Tap 动作，动作播放期间**没有** idle 插入打断
- [ ] 快速连续点击：动作不抽搐重启（800ms 内只播一次）
- [ ] 点击后 idle 计时重置（点击后约 6-14s 才出现待机）
- [ ] 气泡触发 `[motion:happy]` 时模型变 Happy 表情（纯表情路径）约 3 秒后复位

- [ ] **Step 3: shizuku（cubism2，tap_body/shake + 编号表情）**

- [ ] 点击播 `tap_body`（不再是回退 idle）
- [ ] 有语义词表情（如 smile）的触发与复位正常；编号表情 f01 不误触发
- [ ] 切换模型/关闭后控制台无定时器报错

- [ ] **Step 4: 手写 avatar.json 映射验证**

给某个模型目录的 avatar.json 加：

```json
"actions": { "happy": { "motion": "Tap", "motionIndex": 0, "expression": "<该模型真实表情名>" } }
```

重启 dev（或设置窗口重新加载形象列表）后触发 happy：按映射的组/下标/表情播放——
**表情要可见出现，并在动作播放结束后复位**（组合表情经显式播放，结算时复位）。
验证后删掉该映射。

- [ ] **Step 5: 结论**

全部通过 → 收尾（无代码改动）。任一异常 → 回到对应 Task 修正后重跑本清单。

---

## 最终评审修正（第一轮：fork 表情门控）

最终全分支评审发现并修复：**组合表情从未显示**。本计划原先把
`{expression, resetExpression: true}` 传进 `model.motion()`，但已安装的
pixi-live2d-display-lipsyncpatch v0.5.0-ls-8 默认配置
`preserveExpressionOnMotion: true`，motion 选项里的 expression 被
`MotionState.shouldOverrideExpression()` 门控（恒 false）静默丢弃，
`resetExpression` 选项同样无效。修正：表情生命周期收回调度器——动作派发时
组合表情经 `player.playExpression` 显式播放，gen 守卫结算回调里
`(expr || heldFace) && exprTimer === undefined` 时复位（heldFace = 派发时在途
hold 被 clearExpr 取消，其表情残留由结算兜底——同时修复「motion 无表情时旧
表情卡脸」）。`MotionPlayer.playMotion` opts 删除 expression 字段；不翻转
fork 的 preserveExpressionOnMotion 配置（restoreExpression 卡脸风险）。

Task 1 派发分支、Task 2 用例、Task 3 播放器代码块已就地同步为第一轮修正后版本（第二轮已再度同步，见下节）。
另打包修正：resolveMapped 空映射与越界 motionIndex 整条失效（actions.ts）；
actions.test.ts 断言改 toStrictEqual 钉住 `index: undefined` 契约；服务端
actions 透传断言加固（comma-ok、列表响应、motionIndex 0 夹具）。

---

## 最终评审修正（第二轮：播完信号与结算语义）

第二轮 scoped re-review 发现：库的 motion promise 在**动作开始**即 resolve，
第一轮把结算挂在 `.finally` 上是「起播即结算」——动作一开播 idle 就重新武装、
组合表情立即复位，且派发被库内拒绝（promise 仍 resolve）也走结算清零。真实
播完信号是 manager 级 `motionFinish` 事件。修正：

- `MotionPlayer.playMotion` 契约改为 `Promise<boolean>`：真实播完 true /
  库内拒绝启动 false / 加载失败 reject；Task 3 播放器在 motion 起播成功后用
  `motionManager.once('motionFinish')` 包装播完（fork 类型声明未暴露 once，
  加局部结构类型断言；升级 fork 后应移除该断言）。
- 调度器删除世代号 `gen`：库内被抢占的动作不产生自己的播完信号，其结算监听
  随下一次播完一起落地、幂等，无需守卫；保留 gen 反而会在派发被库内拒绝时
  卡死优先级（在播动作的结算被 gen 跳过，currentPriority 永久滞留）。
- false 分支（库内拒绝启动）不清 currentPriority——在播动作的结算会清零并
  武装 idle；false 分支只保证 idle 循环不熄灭（idle 意图按重试间隔重排）。
  已知边界（非阻塞）：库在 currentAudio 未结束/加载失败/无可用 index 时同样
  返回 false 且无在播动作，此时优先级滞留到下一次成功结算——现有模型无
  motion sound、素材有效时不触发，留作后续加固（在途动作计数或 false 时无
  在途才清零）。
- 表情所有权改 `motionExpr` 标志：组合表情派发置 true、结算复位；纯表情
  hold 派发置 false 并由自身定时器复位（到期回调先清 `exprTimer` 再复位，
  复位后不再视为在途）；新动作不带表情且 `motionExpr || heldFace` 时派发即
  复位（`heldFace` 必须在 `clearExpr()` 之前采样）。

Task 1 派发分支、Task 1/2 测试用例、Task 3 播放器代码块已就地同步为第二轮
最终版本（提交 029b396，26 用例全绿；新用例覆盖库内拒绝启动不清优先级、
抢占清旧组合表情、hold 到期后不再视为在途）。

---

## Self-Review

**Spec 覆盖（用户提案 P0/P1）：**
- P0 优先级修正（idle=1/互动=2）→ Task 1/3 ✓
- P0 点击/聊天后重置空闲计时、不固定 2s 起 idle → Task 1（armIdle 语义）✓
- P0 idle 定时器改成调度器、不打断 greet/tap → Task 1/3 ✓
- P0 playIntent 返回真实结果 → Task 1（派发前拒绝）✓
- P0 fake timer 测试（重置/不出 idle/冷却）→ Task 1 用例 ✓
- P1 ModelCapabilities 接口 → Task 4 ✓
- P1 五层降级 → Task 4 ✓
- P1 avatar.json actions 扩展 → Task 5（透传）+ Task 4（解析）+ Task 6（接线）✓
- P1 表情与动作组合播放 → Task 2/4 ✓
- P1 后端探测 motion 组/表情名 → 提案标注「设置页以后再做」，本计划明确不做（前端从已加载模型直接推导，见 Task 4 要点）✓
- 验收覆盖 haru/shizuku/katou 类 → Task 4 夹具 + Task 7 视觉冒烟 ✓
- P2/P3 不在本计划范围 → 计划头部声明 ✓

**占位符扫描：** 各任务含完整代码与测试代码，无 TBD/TODO/「类似 Task N」。Task 3/6 为接线任务，其行为覆盖在 Task 1/2/4 的测试中，验证步骤明确（跑既有套件 + typecheck），不虚构不存在的测试。

**类型一致性：** `ResolvedAction` 在 Task 1 定义于 motionScheduler.ts，Task 4 的 actions.ts 从 `./motionScheduler` import——一致。`MotionPlayer.playMotion` opts 字段（`index`）在 Task 1 定义、Task 2 测试、Task 3 的 model.ts 实现三处一致（组合表情走 playExpression，见最终评审修正）。`AvatarActions` 在 Task 4（actions.ts）定义，Task 5（Go 侧 JSON 形状一致：motion/motionIndex/expression，MotionIndex 用 `*int`）、Task 6（env.d.ts/assetsApi/petStore）引用一致。`modelActions` 字段名在 petStore/App 两处一致。

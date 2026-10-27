// 动作调度器：模型动作的优先级、冷却与空闲循环的单一事实来源（纯逻辑，可 fake timer 测试）。
// 设计要点：
// - 库优先级数值 1=idle、2=normal、3=force；低优先级动作会被高优先级静默忽略
//   （库不保证请求实际生效），所以调度器自己记账 currentPriority，派发前拒绝并返回
//   false——play 的结果是「是否真的开始播放」。
// - idle 由单一可重武装定时器驱动：任何互动（非 idle 意图的 play / notifyInteraction）
//   都会重置它；动作派发时清除、结算时重新武装——即使定时器在动作期间触发，
//   在途的 idle 请求也会被优先级拒绝，动作不会被待机打断。
// - 每次动作派发 bump 世代号 gen，动作结算回调只在自己的世代内生效（旧动作被抢占后
//   迟到结算不会清掉新动作的优先级）；表情不参与世代：在途 hold 由 clearExpr 取消，
//   其复位在动作结算时兜底（见派发分支）。
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
  playMotion(group: string, priority: number, opts?: { index?: number }): Promise<void>
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
  let gen = 0
  let currentPriority = 0
  let idleTimer: number | undefined
  let exprTimer: number | undefined
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
      // 不 bump 世代——在途动作结算只认自己的世代，表情不得使其跳过优先级清零
      lastPlayAt.set(intent, Date.now())
      armIdle()
      void player.playExpression(resolved.expression).catch(() => {})
      clearExpr()
      exprTimer = window.setTimeout(() => {
        if (!disposed) void player.resetExpression().catch(() => {})
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
    const myGen = ++gen
    lastPlayAt.set(intent, Date.now())
    clearIdle()
    // 组合表情必须走显式 playExpression：fork 默认 preserveExpressionOnMotion，
    // motion 选项里的 expression 被门控静默丢弃（resetExpression 选项同样无效）
    const expr = resolved.expression
    const heldFace = exprTimer !== undefined // 派发时在途的 hold 会被 clearExpr 取消
    clearExpr()
    if (expr) void player.playExpression(expr).catch(() => {})
    currentPriority = priority
    void player
      .playMotion(resolved.group, priority, { index: resolved.index })
      .catch(() => {})
      .finally(() => {
        if (disposed || gen !== myGen) return
        currentPriority = 0
        // 组合表情与被打断的旧 hold 表情在结算时复位；期间有新的纯表情 hold
        // 在途则留给 hold 回调复位（hold 拥有当前表情）
        if ((expr || heldFace) && exprTimer === undefined) void player.resetExpression().catch(() => {})
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
      gen += 1 // 让在途结算回调失效（复位回调仅判 disposed）
      clearIdle()
      clearExpr()
    }
  }
}

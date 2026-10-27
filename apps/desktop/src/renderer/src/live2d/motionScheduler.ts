// 动作调度器：模型动作的优先级、冷却与空闲循环的单一事实来源（纯逻辑，可 fake timer 测试）。
// 设计要点：
// - 库优先级数值 1=idle、2=normal、3=force；低优先级动作会被高优先级静默忽略
//   （promise 照常 resolve），所以调度器自己记账 currentPriority，派发前拒绝并返回
//   false——play 的结果是「是否真的开始播放」。
// - idle 由单一可重武装定时器驱动：任何互动（非 idle 意图的 play / notifyInteraction）
//   都会重置它；动作播放期间定时器保持清除态，结算时重新武装。
// - 每次派发 bump 世代号 gen，结算/表情复位回调只在自己的世代内生效（旧动作被抢占
//   后迟到结算不会清掉新动作的优先级）。
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
  playMotion(group: string, priority: number, opts?: { index?: number; expression?: string }): Promise<void>
  playExpression(name: string): Promise<void>
  resetExpression(): Promise<void>
}

export interface MotionScheduler {
  /** 按意图播动作/表情；派发即 resolve，true = 已开始播放/已设置表情 */
  play(intent: MotionIntent, priority?: number): Promise<boolean>
  /** 用户交互（未触发动作的点击/打开面板等）重置空闲计时 */
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
    if (!resolved) {
      // 无匹配：idle 按重试间隔重排，其余意图武装常规空闲计时
      if (intent === 'idle') armIdle(IDLE_RETRY_MS)
      else armIdle()
      return false
    }
    if (resolved.group === null) {
      if (resolved.expression === null) return false
      // 纯表情：不占动作优先级（可与 idle 动作并存），保持 EXPR_HOLD_MS 后复位
      const myGen = ++gen
      lastPlayAt.set(intent, Date.now())
      armIdle()
      void player.playExpression(resolved.expression).catch(() => {})
      clearExpr()
      exprTimer = window.setTimeout(() => {
        if (!disposed && gen === myGen) void player.resetExpression().catch(() => {})
      }, EXPR_HOLD_MS)
      return true
    }
    if (priority < currentPriority) {
      // 高优先级动作在播：库会静默忽略本次请求，提前拒绝返回真实结果
      armIdle()
      return false
    }
    const myGen = ++gen
    lastPlayAt.set(intent, Date.now())
    clearIdle()
    clearExpr()
    currentPriority = priority
    void player
      .playMotion(resolved.group, priority, {
        index: resolved.index,
        expression: resolved.expression ?? undefined
      })
      .catch(() => {})
      .finally(() => {
        if (disposed || gen !== myGen) return
        currentPriority = 0
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
      gen += 1 // 让在途结算/复位回调失效
      clearIdle()
      clearExpr()
    }
  }
}

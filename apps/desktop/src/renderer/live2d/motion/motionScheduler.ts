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
import { type MotionIntent } from '@/live2d/motion/motionMap'

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

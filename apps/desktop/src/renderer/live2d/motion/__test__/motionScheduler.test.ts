import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMotionScheduler,
  P_IDLE,
  P_NORMAL,
  P_FORCE,
  type MotionPlayer,
  type ResolvedAction
} from '@/live2d/motion/motionScheduler'

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

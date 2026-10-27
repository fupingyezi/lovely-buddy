import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMotionScheduler,
  P_IDLE,
  P_NORMAL,
  P_FORCE,
  type MotionPlayer,
  type ResolvedAction
} from '../motionScheduler'

function pending(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 假播放器：记录每次 playMotion 的组/优先级，promise 由测试手动结算 */
function fakePlayer() {
  const calls: { group: string; priority: number }[] = []
  const motions: { resolve: () => void; reject: (e: Error) => void }[] = []
  const player: MotionPlayer = {
    playMotion(group, priority) {
      const p = pending()
      calls.push({ group, priority })
      motions.push(p)
      return p.promise
    },
    playExpression: () => Promise.resolve(),
    resetExpression: () => Promise.resolve()
  }
  return { calls, motions, player }
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

  it('高优先级抢占低优先级：旧动作结算不篡改当前状态', async () => {
    await sched.play('idle', P_IDLE)
    await sched.play('tap', P_NORMAL) // 抢占（库内 idle 提前结束）
    expect(await sched.play('idle', P_IDLE)).toBe(false) // tap 在播
    f.motions[0].resolve() // 旧 idle 迟到结算：gen 已过，不影响 tap
    expect(await sched.play('idle', P_IDLE)).toBe(false)
    f.motions[1].resolve() // tap 结束
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
    f.motions[0].resolve() // tap 结算：不得被纯表情的世代变化跳过
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.calls[1]).toEqual({ group: 'Idle', priority: P_IDLE })
  })

  it('空解析（无动作无表情）按无匹配处理：idle 按重试间隔重排', async () => {
    pick.mockReturnValueOnce({ group: null, index: undefined, expression: null })
    expect(await sched.play('idle', P_IDLE)).toBe(false)
    await vi.advanceTimersByTimeAsync(10000)
    expect(f.calls[0]).toEqual({ group: 'Idle', priority: P_IDLE }) // 重试成功
  })
})

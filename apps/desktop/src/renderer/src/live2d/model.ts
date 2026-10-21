import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch'
import { loadCubismCores } from './loader'
import { initStage } from './stage'
import { INTENT_MOTIONS, pickMotion, type MotionIntent } from './motionMap'

export interface PetModel {
  readonly name: string
  readonly x: number
  readonly y: number
  /** 画布坐标（窗口坐标系）命中检测，模型外 false */
  hitTest(sx: number, sy: number): boolean
  moveTo(x: number, y: number): void
  /** 按意图播动作；无匹配动作时返回 false */
  playIntent(intent: MotionIntent, priority?: number): Promise<boolean>
  destroy(): void
}

// 同一 url 的加载共享一个 Promise：StrictMode 双挂载不重复拉模型
const cache = new Map<string, Promise<PetModel>>()

export function loadPetModel(canvas: HTMLCanvasElement, url: string, name: string): Promise<PetModel> {
  let p = cache.get(url)
  if (!p) {
    p = createPetModel(canvas, url, name).catch((e: unknown) => {
      cache.delete(url) // 失败允许重试
      throw e
    })
    cache.set(url, p)
  }
  return p
}

/** 切换模型时销毁旧实例；加载中的等待其完成后再销毁（幂等）。 */
export async function releasePetModel(url: string): Promise<void> {
  const p = cache.get(url)
  if (!p) return
  cache.delete(url)
  try {
    const pet = await p
    pet.destroy()
  } catch {
    // 加载失败无需销毁
  }
}

async function createPetModel(canvas: HTMLCanvasElement, url: string, name: string): Promise<PetModel> {
  await loadCubismCores()
  const app = initStage(canvas) // 顺便挂 window.PIXI（fork 模块求值时需要）

  // fork 模块在求值时要求 window.Live2D / window.PIXI 已就绪，必须 core 注入后再动态 import
  const { Live2DModel: Live2DModelCtor } = await import('pixi-live2d-display-lipsyncpatch')

  // 关闭内置交互（autoHitTest/autoFocus），命中/拖拽由 interact.ts 接管
  const model = await Live2DModelCtor.from(url, { autoHitTest: false, autoFocus: false })

  // 目标身高按屏幕高度约 22%（180-380px）；窗口只包住模型 + 动作边距，不盖桌面
  const targetHeight = Math.min(Math.max(Math.round(window.screen.availHeight * 0.22), 180), 380)
  const scale = targetHeight / model.height
  const winW = Math.min(Math.max(Math.ceil(model.width * scale * 1.5), 360), 1200)
  const winH = Math.min(Math.max(Math.ceil(targetHeight * 1.35), 400), 900)
  if (Math.abs(window.innerWidth - winW) > 2 || Math.abs(window.innerHeight - winH) > 2) {
    window.lovelybuddy.resizeWindow(winW, winH)
    await nextResize()
  }

  // 锚点取脚底中点，站在窗口下沿中央（拖拽移动的是窗口，主进程持久化位置）
  model.scale.set(scale)
  model.anchor.set(0.5, 1)
  model.position.set(window.innerWidth / 2, window.innerHeight - 8)
  app.stage.addChild(model)

  const groups = motionGroups(model)
  const facade: PetModel = {
    name,
    get x() {
      return model.position.x
    },
    get y() {
      return model.position.y
    },
    hitTest(sx, sy) {
      // fork 的 hitTest 接受世界坐标（内部 toModelPosition），返回命中的 hit area 名
      return model.hitTest(sx, sy).length > 0
    },
    moveTo(x, y) {
      model.position.set(x, y)
    },
    playIntent(intent, priority = 1) {
      const group = pickMotion(intent, groups)
      if (!group) return Promise.resolve(false)
      return model
        .motion(group, undefined, priority)
        .then(() => true)
        .catch(() => false)
    },
    destroy() {
      if (disposed) return
      disposed = true
      window.clearTimeout(idleTimer)
      try {
        model.parent?.removeChild(model)
        model.destroy()
      } catch (e) {
        // fork 对刚加载完的模型 destroy 可能抛错，销毁失败不影响后续
        console.warn('[lovely-buddy] 模型销毁异常（可忽略）:', e)
      }
    }
  }

  let disposed = false
  let idleTimer = window.setTimeout(startIdle, 2000)
  void facade.playIntent('greet')

  /** idle 循环：随机挑一个 idle 类动作，播完歇 6-14s 再续 */
  function startIdle(): void {
    if (disposed) return
    const idleGroups = groups.filter((g) =>
      INTENT_MOTIONS.idle.some((c) => c.toLowerCase() === g.toLowerCase())
    )
    if (idleGroups.length > 0) {
      const g = idleGroups[Math.floor(Math.random() * idleGroups.length)]
      void model
        .motion(g, undefined, 2)
        .catch(() => {})
        .finally(() => {
          idleTimer = window.setTimeout(startIdle, 6000 + Math.random() * 8000)
        })
    } else {
      idleTimer = window.setTimeout(startIdle, 10000)
    }
  }

  return facade
}

/** 模型可用的动作组名（来自模型设定文件中的 motion 定义） */
function motionGroups(model: Live2DModel): string[] {
  return Object.keys(model.internalModel.motionManager.definitions)
}

/** 等窗口完成 resize（主进程 setBounds 触发 window resize 事件），超时兜底 300ms。 */
function nextResize(timeoutMs = 300): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      window.removeEventListener('resize', done)
      resolve()
    }
    window.addEventListener('resize', done)
    window.setTimeout(done, timeoutMs)
  })
}

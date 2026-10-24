import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch'
import { Point, Rectangle } from 'pixi.js'
import { hitAnyDrawable } from './hitbox'
import { loadCubismCores } from './loader'
import { initStage } from './stage'
import { INTENT_MOTIONS, pickMotion, type MotionIntent } from './motionMap'
import { headAnchorOffset, shiftToKeepScreenPosition, type Pos } from './windowAnchor'
import { setModelBase } from './windowGeometry'
import { waitForResize } from './waitForResize'

export interface PetModel {
  readonly name: string
  readonly x: number
  readonly y: number
  /** 角色头部左上角（窗口坐标）：气泡尾巴锚点。按默认姿态绘制部件实际艺术边界
   *  推导（头顶 = 盒顶、头部左缘 = 顶部带并集左缘，画布留白不计）；
   *  getter 实时叠加 position，windowAnchor 位移后仍准确（多面板扩展量叠加时天然正确）。
   *  cubism2 包围盒首帧 draw 后才有效（矩阵初始化），加载后补算一帧即稳定。 */
  readonly anchor: Pos
  /** 画布坐标（窗口坐标系）命中检测，模型外 false */
  hitTest(sx: number, sy: number): boolean
  moveTo(x: number, y: number): void
  /** 按意图播动作；无匹配动作时返回 false */
  playIntent(intent: MotionIntent, priority?: number): Promise<boolean>
  destroy(): void
}

// 同一 url 的加载共享一个 Promise：StrictMode 双挂载不重复拉模型
const cache = new Map<string, Promise<PetModel>>()

// hitTest 复用临时对象（避免每指针移动分配）
const hitPoint = new Point()
const hitModelPoint = new Point()
const hitBounds = new Rectangle()

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
  setModelBase(null) // 模型已释放：几何 store 回到无基准状态
}

async function createPetModel(canvas: HTMLCanvasElement, url: string, name: string): Promise<PetModel> {
  await loadCubismCores()
  const app = initStage(canvas) // 顺便挂 window.PIXI（fork 模块求值时需要）

  // fork 模块在求值时要求 window.Live2D / window.PIXI 已就绪，必须 core 注入后再动态 import
  const { Live2DModel: Live2DModelCtor } = await import('pixi-live2d-display-lipsyncpatch')

  // 关闭内置交互（autoHitTest/autoFocus），命中/拖拽由 interact.ts 接管
  const model = await Live2DModelCtor.from(url, { autoHitTest: false, autoFocus: false })

  // 目标身高按屏幕高度约 22%（180-380px）；窗口 = 模型视觉包围盒（碰撞箱）严格贴合，
  // 高度补 8px 站台偏移（脚底距窗口下沿），无额外边距——动画挥出的部位可能被窗口裁边（已知取舍）
  const targetHeight = Math.min(Math.max(Math.round(window.screen.availHeight * 0.22), 180), 380)
  const scale = targetHeight / model.height
  // 画布像素尺寸（缩放前基准）：PIXI 的 width/height 随 scale.set 变化，
  // 锚点等几何换算必须用这里的未缩放值（窗口尺寸也由此推导）
  const canvasW = model.width
  const canvasH = model.height
  const winW = Math.ceil(canvasW * scale)
  const winH = Math.ceil(canvasH * scale) + 8 // 窗口高 = 模型高 + 8px 站台偏移
  if (Math.abs(window.innerWidth - winW) > 2 || Math.abs(window.innerHeight - winH) > 2) {
    window.lovelybuddy.resizeWindow(winW, winH)
    await waitForResize()
  }

  // 锚点取脚底中点，站在窗口下沿中央（拖拽移动的是窗口，主进程持久化位置）
  model.scale.set(scale)
  model.anchor.set(0.5, 1)
  model.position.set(window.innerWidth / 2, window.innerHeight - 8)
  // 发布模型基准窗口尺寸（几何 store）：气泡/菜单靠 size.h - base.h 求头顶窗口坐标。
  // 加载中被 releasePetModel 提前释放（快速连续切模型）则不发布，避免旧模型覆盖新基准。
  if (cache.get(url)) {
    setModelBase({ w: winW, h: winH })
  }
  app.stage.addChild(model)

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

  // 绘制部件总数（cubism4 没有基类的 drawDataCount，用 getDrawableIDs 通用获取）
  const drawableCount = model.internalModel.getDrawableIDs().length

  // 头部左上角锚点（相对模型位置的偏移）：按绘制部件实际艺术边界推导——
  // 尾巴锚画布盒顶/盒角会飘在人物上方或偏到一侧（画布留白、头部水平居中）。
  // cubism4 加载后包围盒即可用；cubism2 的 getTransformedPoints 依赖 setupDraw
  // （首帧 draw）初始化的矩阵、首帧前全零——退化时挂 ticker 下一帧重试。
  let disposed = false
  const tmpBounds = new Rectangle()
  const headAnchor = { x: 0, y: 0 }
  let anchorDone = false
  let headAnchorTries = 0
  const tryComputeHeadAnchor = (): void => {
    if (anchorDone || disposed) return
    const o = headAnchorOffset(
      (i) => model.internalModel.getDrawableBounds(i, tmpBounds),
      drawableCount,
      canvasW,
      canvasH,
      scale
    )
    if (o) {
      anchorDone = true
      headAnchor.x = o.x
      headAnchor.y = o.y
      app.ticker.remove(tryComputeHeadAnchor)
      return
    }
    if (++headAnchorTries >= 180) {
      anchorDone = true
      headAnchor.x = 0
      headAnchor.y = (0 - canvasH) * scale // 兜底：包围盒始终无效时按画布顶居中
      app.ticker.remove(tryComputeHeadAnchor)
    }
  }
  tryComputeHeadAnchor()
  if (!anchorDone) app.ticker.add(tryComputeHeadAnchor)

  const groups = motionGroups(model)
  const facade: PetModel = {
    name,
    get x() {
      return model.position.x
    },
    get y() {
      return model.position.y
    },
    get anchor() {
      return { x: model.position.x + headAnchor.x, y: model.position.y + headAnchor.y }
    },
    hitTest(sx, sy) {
      // 1) 模型自带 HitAreas（如 shizuku）：fork 的 hitTest 接受世界坐标（内部 toModelPosition）
      if (model.hitTest(sx, sy).length > 0) return true
      // 2) 无 HitAreas 的模型（如官方 haru）：按实际绘制部件顶点做可视碰撞箱检测
      const p = model.toModelPosition(hitPoint.set(sx, sy), hitModelPoint)
      const im = model.internalModel
      return hitAnyDrawable((i) => im.getDrawableBounds(i, hitBounds), drawableCount, p.x, p.y)
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
      window.removeEventListener('resize', onWinResize)
      app.ticker.remove(tryComputeHeadAnchor)
      try {
        model.parent?.removeChild(model)
        model.destroy()
      } catch (e) {
        // fork 对刚加载完的模型 destroy 可能抛错，销毁失败不影响后续
        console.warn('[lovely-buddy] 模型销毁异常（可忽略）:', e)
      }
    }
  }

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

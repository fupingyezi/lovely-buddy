import { Point, Rectangle } from 'pixi.js'
import { resolveAction, type AvatarActions } from './actions'
import { deriveCapabilities } from './capabilities'
import { hitAnyDrawable } from './hitbox'
import { loadCubismCores } from './loader'
import { initStage } from './stage'
import { type MotionIntent } from './motionMap'
import { createMotionScheduler, P_NORMAL, type MotionPlayer } from './motionScheduler'
import { headAnchorOffset, shiftToKeepScreenPosition, type Pos } from './windowAnchor'
import { getActiveModel, setActiveModel } from './modelBus'
import { setModelBase } from './windowGeometry'
import { waitForResize } from './waitForResize'

export interface PetModel {
  readonly name: string
  /** 模型位置（窗口坐标，脚底中点）；销毁后兜底 0（总线先摘，正常读不到） */
  readonly x: number
  readonly y: number
  /** 角色头部左上角（窗口坐标）：气泡尾巴锚点。按默认姿态绘制部件实际艺术边界
   *  推导（头顶 = 盒顶、头部左缘 = 顶部带并集左缘，画布留白不计）；
   *  getter 实时叠加 position，windowAnchor 位移后仍准确（多面板扩展量叠加时天然正确）。
   *  cubism2 包围盒首帧 draw 后才有效（矩阵初始化），加载后补算一帧即稳定。
   *  销毁后兜底 (0,0)。 */
  readonly anchor: Pos
  /** 画布坐标（窗口坐标系）命中检测，模型外/已销毁 false */
  hitTest(sx: number, sy: number): boolean
  moveTo(x: number, y: number): void
  /** 按意图播动作；无匹配动作时返回 false */
  playIntent(intent: MotionIntent, priority?: number): Promise<boolean>
  /** 未派发动作的互动也重置空闲计时（点击被冷却/优先级拒时 idle 不立即触发） */
  notifyInteraction(): void
  destroy(): void
}

// 同一 url 的加载共享一个 Promise：StrictMode 双挂载不重复拉模型
const cache = new Map<string, Promise<PetModel>>()

// hitTest 复用临时对象（避免每指针移动分配）
const hitPoint = new Point()
const hitModelPoint = new Point()
const hitBounds = new Rectangle()

export function loadPetModel(
  canvas: HTMLCanvasElement,
  url: string,
  name: string,
  actions?: AvatarActions
): Promise<PetModel> {
  let p = cache.get(url)
  if (!p) {
    p = createPetModel(canvas, url, name, actions).catch((e: unknown) => {
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
    // 先摘总线再销毁：PIXI destroy 会把 transform 置空，销毁后 facade 的
    // anchor/x/y getter 读 model.position 直接抛 "reading 'position'"——
    // 而紧随其后的 setModelBase(null) 会让订阅几何的组件（气泡）在
    // "已销毁、总线未清"的窗口内重渲染（总线清空原本在下一轮 effect
    // cleanup，晚于这里的微任务）。先摘总线把窗口关死。
    if (getActiveModel() === pet) setActiveModel(null)
    pet.destroy()
  } catch {
    // 加载失败无需销毁
  }
  setModelBase(null) // 模型已释放：几何 store 回到无基准状态
}

async function createPetModel(
  canvas: HTMLCanvasElement,
  url: string,
  name: string,
  actions?: AvatarActions
): Promise<PetModel> {
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

  const caps = deriveCapabilities(model)
  const player: MotionPlayer = {
    playMotion(group, priority, opts) {
      return model.motion(group, opts?.index, priority).then(() => {})
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
  const scheduler = createMotionScheduler((intent) => resolveAction(intent, caps, actions), player)
  const facade: PetModel = {
    name,
    // 销毁后 PIXI transform 已置空，读 model.position 会抛错——所有 getter 兜底。
    // 正常路径总线先摘（releasePetModel），这些兜底防的是残留引用（interact 监听器等）。
    get x() {
      return disposed ? 0 : model.position.x
    },
    get y() {
      return disposed ? 0 : model.position.y
    },
    get anchor() {
      if (disposed) return { x: 0, y: 0 }
      return { x: model.position.x + headAnchor.x, y: model.position.y + headAnchor.y }
    },
    hitTest(sx, sy) {
      if (disposed) return false
      // 1) 模型自带 HitAreas（如 shizuku）：fork 的 hitTest 接受世界坐标（内部 toModelPosition）
      if (model.hitTest(sx, sy).length > 0) return true
      // 2) 无 HitAreas 的模型（如官方 haru）：按实际绘制部件顶点做可视碰撞箱检测
      const p = model.toModelPosition(hitPoint.set(sx, sy), hitModelPoint)
      const im = model.internalModel
      return hitAnyDrawable((i) => im.getDrawableBounds(i, hitBounds), drawableCount, p.x, p.y)
    },
    moveTo(x, y) {
      if (disposed) return
      model.position.set(x, y)
    },
    playIntent(intent: MotionIntent, priority?: number) {
      if (disposed) return Promise.resolve(false)
      return scheduler.play(intent, priority ?? P_NORMAL)
    },
    notifyInteraction() {
      scheduler.notifyInteraction()
    },
    destroy() {
      if (disposed) return
      disposed = true
      scheduler.destroy()
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

  void scheduler.play('greet') // 问候动作；无问候组的模型走 resolveAction 的 idle 兜底

  return facade
}

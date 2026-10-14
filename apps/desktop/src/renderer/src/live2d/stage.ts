import * as PIXI from 'pixi.js'
import '@pixi/unsafe-eval' // CSP 禁 unsafe-eval，pixi 内部 new Function 走预编译着色器替代路径

// 模块级单例：整个应用只有一个 PIXI.Application（StrictMode 双挂载下幂等）。
let app: PIXI.Application | null = null

export function initStage(canvas: HTMLCanvasElement): PIXI.Application {
  if (app) return app
  // lipsyncpatch 库内部取 window.PIXI，必须在任何 Live2DModel 调用前挂上
  window.PIXI = PIXI
  app = new PIXI.Application({
    view: canvas,
    autoStart: true,
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true
  })
  return app
}

export function getStage(): PIXI.Application | null {
  return app
}

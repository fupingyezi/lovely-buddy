// window.lovelybuddy 由 preload 通过 contextBridge 注入（保持与 src/preload/index.ts 的 LovelybuddyApi 一致）
declare global {
  interface ModelInfo {
    name: string
    url: string
    kind: 'moc' | 'moc3'
  }

  interface LovelybuddyApi {
    getRuntime: () => Promise<{ baseUrl: string; token: string; dev: boolean }>
    setPassthrough: (on: boolean) => void
    listModels: () => Promise<ModelInfo[]>
    pickModelDir: () => Promise<ModelInfo[]>
    moveWindow: (dx: number, dy: number) => void
    moveWindowEnd: () => void
    resizeWindow: (width: number, height: number) => void
    quit: () => void
  }

  interface Window {
    lovelybuddy: LovelybuddyApi
    // Cubism core UMD 全局（live2d/loader.ts 动态注入），pixi-live2d-display 依赖
    PIXI?: unknown
    Live2D?: unknown
    Live2DCubismCore?: unknown
  }
}

export {}

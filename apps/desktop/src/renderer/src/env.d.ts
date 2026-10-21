// window.lovelybuddy 由 preload 通过 contextBridge 注入（保持与 src/preload/index.ts 的 LovelybuddyApi 一致）
declare global {
  interface ModelInfo {
    name: string
    url: string
    kind: 'moc' | 'moc3'
  }

  interface AvatarInfo extends ModelInfo {
    /** 形象目录名（服务端唯一标识） */
    slug: string
    /** 相对模型根目录的入口文件 */
    entry: string
    author?: string
    version?: string
    license?: string
    homepage?: string
    /** 来源：导入写入（local/url），手工放入为空 */
    source?: 'local' | 'url'
  }

  interface LovelybuddyApi {
    getRuntime: () => Promise<{ baseUrl: string; token: string; dev: boolean }>
    setPassthrough: (on: boolean) => void
    /** 弹出本地文件/目录选择框（zip 或目录），返回路径或 canceled */
    pickImportPath: (mode: 'zip' | 'dir') => Promise<{ canceled: boolean; path: string | null }>
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

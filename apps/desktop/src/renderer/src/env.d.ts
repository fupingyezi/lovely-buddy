// window.skyi 由 preload 通过 contextBridge 注入（保持与 src/preload/index.ts 的 SkyiApi 一致）
interface SkyiApi {
  getRuntime: () => Promise<{ baseUrl: string; token: string; dev: boolean }>
  setPassthrough: (on: boolean) => void
  quit: () => void
}

declare global {
  interface Window {
    skyi: SkyiApi
  }
}

export {}

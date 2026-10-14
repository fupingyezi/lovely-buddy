import { create } from 'zustand'

export type BackendStatus = 'connecting' | 'online' | 'offline'

const MODEL_URL_KEY = 'skyi:model-url'
const PLACEHOLDER_DISMISSED_KEY = 'skyi:placeholder-dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(PLACEHOLDER_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

interface PetState {
  models: ModelInfo[]
  modelUrl: string | null
  modelName: string | null
  modelError: string | null
  /** 用户手动关闭了「未找到模型」占位卡（扫描到模型后自动复位） */
  placeholderDismissed: boolean
  status: BackendStatus
  version: string | null
  loadModels: () => Promise<void>
  selectModel: (info: ModelInfo) => void
  pickModelDir: () => Promise<void>
  dismissPlaceholder: () => void
  setModelError: (err: string | null) => void
  setStatus: (status: BackendStatus, version?: string | null) => void
}

export const usePetStore = create<PetState>()((set, get) => ({
  models: [],
  modelUrl: null,
  modelName: null,
  modelError: null,
  placeholderDismissed: readDismissed(),
  status: 'connecting',
  version: null,

  async loadModels() {
    try {
      const models = await window.skyi.listModels()
      const restored = localStorage.getItem(MODEL_URL_KEY)
      const next = models.find((m) => m.url === (get().modelUrl ?? restored)) ?? models[0] ?? null
      // 扫描到模型即复位占位卡关闭状态（用户下次放模型进来能立刻看到桌宠）
      set({
        models,
        modelUrl: next?.url ?? null,
        modelName: next?.name ?? null,
        modelError: null,
        placeholderDismissed: next ? false : get().placeholderDismissed
      })
    } catch (e) {
      set({ modelError: String(e) })
    }
  },

  selectModel(info) {
    localStorage.setItem(MODEL_URL_KEY, info.url)
    set({ modelUrl: info.url, modelName: info.name, modelError: null, placeholderDismissed: false })
  },

  async pickModelDir() {
    const models = await window.skyi.pickModelDir()
    const next = models[0] ?? null
    set({
      models,
      modelUrl: next?.url ?? null,
      modelName: next?.name ?? null,
      modelError: null,
      placeholderDismissed: next ? false : get().placeholderDismissed
    })
  },

  dismissPlaceholder() {
    try {
      localStorage.setItem(PLACEHOLDER_DISMISSED_KEY, '1')
    } catch {
      // 隐私模式写失败则本次会话内关闭
    }
    set({ placeholderDismissed: true })
  },

  setModelError(err) {
    set({ modelError: err })
  },

  setStatus(status, version = null) {
    set({ status, version: version ?? get().version })
  }
}))

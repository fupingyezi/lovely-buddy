import { create } from 'zustand'
import { deleteAvatar, importAvatar, listAvatars, type ImportSource } from '../lib/assetsApi'

export type BackendStatus = 'connecting' | 'online' | 'offline'

const MODEL_URL_KEY = 'lovelybuddy:model-url'
const PLACEHOLDER_DISMISSED_KEY = 'lovelybuddy:placeholder-dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(PLACEHOLDER_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

interface PetState {
  models: AvatarInfo[]
  modelUrl: string | null
  modelName: string | null
  modelError: string | null
  /** 用户手动关闭了「未找到模型」占位卡（扫描到模型后自动复位） */
  placeholderDismissed: boolean
  /** 导入进行中（UI 显示状态、防重复提交） */
  importing: boolean
  importError: string | null
  status: BackendStatus
  version: string | null
  loadModels: () => Promise<void>
  selectModel: (info: AvatarInfo) => void
  /** 导入形象；成功后自动应用（auto_apply_avatar 默认开，设置项留 M3）。返回是否成功。 */
  importModel: (source: ImportSource) => Promise<boolean>
  /** 删除形象；若删的是当前选中，自动切到剩余第一个。确认对话框由 UI 层负责。 */
  deleteModel: (info: AvatarInfo) => Promise<void>
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
  importing: false,
  importError: null,
  status: 'connecting',
  version: null,

  async loadModels() {
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const models = await listAvatars(rt)
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

  async importModel(source) {
    set({ importing: true, importError: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const avatar = await importAvatar(rt, source)
      const models = await listAvatars(rt)
      localStorage.setItem(MODEL_URL_KEY, avatar.url)
      // 自动应用：选中新形象并复位占位卡
      set({
        models,
        modelUrl: avatar.url,
        modelName: avatar.name,
        modelError: null,
        placeholderDismissed: false,
        importing: false
      })
      return true
    } catch (e) {
      set({ importing: false, importError: e instanceof Error ? e.message : String(e) })
      return false
    }
  },

  async deleteModel(info) {
    const rt = await window.lovelybuddy.getRuntime()
    await deleteAvatar(rt, info.slug)
    const models = await listAvatars(rt)
    const kept = models.find((m) => m.url === get().modelUrl)
    set({
      models,
      modelUrl: kept?.url ?? models[0]?.url ?? null,
      modelName: kept?.name ?? models[0]?.name ?? null,
      modelError: null
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

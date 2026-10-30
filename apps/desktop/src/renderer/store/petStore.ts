import { create } from 'zustand'
import type { AvatarActions } from '@/live2d/motion/actions'
import { deleteAvatar, importAvatar, listAvatars, type ImportSource } from '@/lib/assetsApi'

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
  modelActions: AvatarActions | null
  modelError: string | null
  /** 用户手动关闭了「未找到模型」占位卡（扫描到模型后自动复位） */
  placeholderDismissed: boolean
  /** 导入进行中（UI 显示状态、防重复提交） */
  importing: boolean
  importError: string | null
  /** 最近一次导入尝试的源名（导入中/失败行展示；成功清除） */
  importName: string | null
  status: BackendStatus
  version: string | null
  /** preferredUrl：设置窗口广播的目标形象 url（选择/导入/删除后的生效项），优先级高于内存与 localStorage */
  loadModels: (preferredUrl?: string) => Promise<void>
  selectModel: (info: AvatarInfo) => void
  /** 导入形象；成功后自动应用（auto_apply_avatar 默认开，设置项留 M3）。返回是否成功。 */
  importModel: (source: ImportSource) => Promise<boolean>
  /** 删除形象；若删的是当前选中，自动切到剩余第一个。确认对话框由 UI 层负责。 */
  deleteModel: (info: AvatarInfo) => Promise<void>
  /** 清除导入失败行（设计：失败行保留直到用户移除） */
  clearImportError: () => void
  dismissPlaceholder: () => void
  setModelError: (err: string | null) => void
  setStatus: (status: BackendStatus, version?: string | null) => void
}

export const usePetStore = create<PetState>()((set, get) => ({
  models: [],
  modelUrl: null,
  modelName: null,
  modelActions: null,
  modelError: null,
  placeholderDismissed: readDismissed(),
  importing: false,
  importError: null,
  importName: null,
  status: 'connecting',
  version: null,

  async loadModels(preferredUrl) {
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const models = await listAvatars(rt)
      const restored = localStorage.getItem(MODEL_URL_KEY)
      const next = models.find((m) => m.url === (preferredUrl ?? get().modelUrl ?? restored)) ?? models[0] ?? null
      // 生效的 url 写回 localStorage：设置窗口与桌宠窗口（及重启后）选择保持一致
      if (next) localStorage.setItem(MODEL_URL_KEY, next.url)
      // 扫描到模型即复位占位卡关闭状态（用户下次放模型进来能立刻看到桌宠）
      set({
        models,
        modelUrl: next?.url ?? null,
        modelName: next?.name ?? null,
        modelActions: next?.actions ?? null,
        modelError: null,
        placeholderDismissed: next ? false : get().placeholderDismissed
      })
    } catch (e) {
      set({ modelError: String(e) })
    }
  },

  selectModel(info) {
    localStorage.setItem(MODEL_URL_KEY, info.url)
    set({
      modelUrl: info.url,
      modelName: info.name,
      modelActions: info.actions ?? null,
      modelError: null,
      placeholderDismissed: false
    })
  },

  async importModel(source) {
    const label = source.type === 'url' ? source.value : (source.value.split(/[\\/]/).pop() ?? source.value)
    set({ importing: true, importError: null, importName: label })
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
        modelActions: avatar.actions ?? null,
        modelError: null,
        placeholderDismissed: false,
        importing: false,
        importName: null
      })
      return true
    } catch (e) {
      // importName 保留：失败行展示尝试导入的源名
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
      modelActions: kept ? (kept.actions ?? null) : (models[0]?.actions ?? null),
      modelError: null
    })
  },

  clearImportError() {
    set({ importError: null, importName: null })
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

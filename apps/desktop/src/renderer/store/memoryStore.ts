// 角色设定·记忆卡状态：列表 + 搜索（300ms 防抖）+ 新增表单 + 删除。
import { create } from 'zustand'
import { addMemory, deleteMemory, listMemories, type MemoryItem } from '@/lib/memoryApi'

export type MemoryType = '偏好' | '事实' | '习惯'

export const MEMORY_TYPES: MemoryType[] = ['偏好', '事实', '习惯']

interface MemoryStore {
  memories: MemoryItem[]
  total: number
  q: string
  loading: boolean
  adding: boolean
  composerOpen: boolean
  addType: MemoryType
  addText: string
  error: string | null
  load: (q?: string) => Promise<void>
  setQ: (q: string) => void
  openComposer: () => void
  closeComposer: () => void
  setAddType: (t: MemoryType) => void
  setAddText: (t: string) => void
  add: () => Promise<void>
  remove: (id: number) => Promise<void>
}

let searchTimer: ReturnType<typeof setTimeout> | null = null

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  memories: [],
  total: 0,
  q: '',
  loading: true,
  adding: false,
  composerOpen: false,
  addType: '偏好',
  addText: '',
  error: null,

  load: async (q = get().q) => {
    set({ loading: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const data = await listMemories(rt, q)
      set({ memories: data.memories, total: data.total })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '记忆读取失败' })
    } finally {
      set({ loading: false })
    }
  },

  setQ: (q) => {
    set({ q })
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void get().load(q), 300)
  },

  openComposer: () => set({ composerOpen: true, addText: '' }),
  closeComposer: () => set({ composerOpen: false, addText: '' }),
  setAddType: (t) => set({ addType: t }),
  setAddText: (t) => set({ addText: t }),

  add: async () => {
    const { addType, addText } = get()
    if (addText.trim() === '') return
    set({ adding: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      await addMemory(rt, addType, addText.trim())
      set({ composerOpen: false, addText: '' })
      await get().load()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '记忆保存失败' })
    } finally {
      set({ adding: false })
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      await deleteMemory(rt, id)
      await get().load()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '记忆删除失败' })
    }
  }
}))

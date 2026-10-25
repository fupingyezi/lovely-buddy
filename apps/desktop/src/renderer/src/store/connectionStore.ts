// 模型与连接全局状态：配置列表 + 新增/编辑表单流程（测试连接→保存并启用）。
// 保存时带上最近一次「测试连接」的结果（tested/test_ok），服务端据此落 LastCheck/CheckFail。
import { create } from 'zustand'
import {
  addConnection,
  deleteConnection,
  fetchConfig,
  testConnection,
  updateConnection,
  type ConfigState,
  type ConnInput,
  type ConnectionInfo,
  type TestInput
} from '../lib/configApi'

interface ConnectionStore {
  config: ConfigState | null
  loading: boolean
  error: string | null // 页面级错误（读取/保存失败）
  formOpen: boolean
  editing: ConnectionInfo | null // 编辑模式的行（null = 新增）
  saving: boolean
  testing: boolean
  testResult: { ok: boolean; message: string } | null
  load: () => Promise<void>
  openAdd: () => void
  openEdit: (c: ConnectionInfo) => void
  closeForm: () => void
  add: (input: ConnInput) => Promise<void>
  update: (id: string, input: ConnInput) => Promise<void>
  remove: (id: string) => Promise<void>
  test: (input: TestInput) => Promise<void>
  clearTest: () => void
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  config: null,
  loading: false,
  error: null,
  formOpen: false,
  editing: null,
  saving: false,
  testing: false,
  testResult: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      set({ config: await fetchConfig(rt) })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '配置读取失败' })
    } finally {
      set({ loading: false })
    }
  },

  openAdd: () => set({ formOpen: true, editing: null, testResult: null }),
  openEdit: (c) => set({ formOpen: true, editing: c, testResult: null }),
  closeForm: () => set({ formOpen: false, editing: null, testResult: null, error: null }),

  add: async (input) => {
    set({ saving: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const testResult = get().testResult
      const config = await addConnection(rt, {
        ...input,
        tested: testResult !== null,
        test_ok: testResult?.ok === true
      })
      set({ config, formOpen: false, testResult: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '保存失败' })
    } finally {
      set({ saving: false })
    }
  },

  update: async (id, input) => {
    set({ saving: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const testResult = get().testResult
      const config = await updateConnection(rt, id, {
        ...input,
        tested: testResult !== null,
        test_ok: testResult?.ok === true
      })
      set({ config, formOpen: false, editing: null, testResult: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '保存失败' })
    } finally {
      set({ saving: false })
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      set({ config: await deleteConnection(rt, id) })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '删除失败' })
    }
  },

  test: async (input) => {
    set({ testing: true })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const r = await testConnection(rt, input)
      set({
        testResult: r.ok
          ? {
              ok: true,
              message: r.latency_ms === undefined ? '配置合法（未配置探活地址）' : `连接成功 · ${r.latency_ms}ms`
            }
          : { ok: false, message: r.error ?? '连接失败' }
      })
    } catch (e) {
      set({ testResult: { ok: false, message: e instanceof Error ? e.message : '测试失败' } })
    } finally {
      set({ testing: false })
    }
  },

  clearTest: () => set({ testResult: null })
}))

// 角色设定·人设卡状态：文本/开关 + 已保存基准（dirty 判定保存钮）。
// 保存成功后服务端 trim 回写，以响应为准更新本地。
import { create } from 'zustand'
import { getPersona, putPersona } from '@/lib/personaApi'

interface PersonaStore {
  text: string
  enabled: boolean
  savedText: string
  savedEnabled: boolean
  loading: boolean
  saving: boolean
  error: string | null
  load: () => Promise<void>
  setText: (t: string) => void
  setEnabled: (on: boolean) => void
  save: () => Promise<void>
}

export const usePersonaStore = create<PersonaStore>((set, get) => ({
  text: '',
  enabled: false,
  savedText: '',
  savedEnabled: false,
  loading: true,
  saving: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const st = await getPersona(rt)
      set({ text: st.text, enabled: st.enabled, savedText: st.text, savedEnabled: st.enabled })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '人设读取失败' })
    } finally {
      set({ loading: false })
    }
  },

  setText: (t) => set({ text: t }),
  setEnabled: (on) => set({ enabled: on }),

  save: async () => {
    const { text, enabled } = get()
    set({ saving: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const st = await putPersona(rt, { text, enabled })
      set({ text: st.text, enabled: st.enabled, savedText: st.text, savedEnabled: st.enabled })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '人设保存失败' })
    } finally {
      set({ saving: false })
    }
  }
}))

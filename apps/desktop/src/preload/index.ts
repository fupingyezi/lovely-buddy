import { contextBridge, ipcRenderer } from 'electron'

export interface Runtime {
  baseUrl: string
  token: string
  dev: boolean
}

export interface SkyiApi {
  /** 获取后端地址与鉴权 token（打包模式由主进程随机生成） */
  getRuntime: () => Promise<Runtime>
  /** 点击穿透开关（forward:true） */
  setPassthrough: (on: boolean) => void
  quit: () => void
}

const skyi: SkyiApi = {
  getRuntime: () => ipcRenderer.invoke('skyi:get-runtime'),
  setPassthrough: (on) => ipcRenderer.send('skyi:set-passthrough', on),
  quit: () => ipcRenderer.send('skyi:quit')
}

contextBridge.exposeInMainWorld('skyi', skyi)

import { contextBridge, ipcRenderer } from 'electron'

export interface Runtime {
  baseUrl: string
  token: string
  dev: boolean
}

export interface ModelInfo {
  name: string
  url: string
  kind: 'moc' | 'moc3'
}

export interface SkyiApi {
  /** 获取后端地址与鉴权 token（打包模式由主进程随机生成） */
  getRuntime: () => Promise<Runtime>
  /** 点击穿透开关（forward:true） */
  setPassthrough: (on: boolean) => void
  /** 扫描模型根目录，返回可加载的模型列表 */
  listModels: () => Promise<ModelInfo[]>
  /** 弹出目录选择框并持久化模型根目录，返回新列表 */
  pickModelDir: () => Promise<ModelInfo[]>
  /** 拖拽：按屏幕坐标增量移动窗口（主进程夹紧在屏幕内） */
  moveWindow: (dx: number, dy: number) => void
  /** 拖拽结束：持久化窗口位置 */
  moveWindowEnd: () => void
  /** 模型加载后按显示尺寸调整窗口（底部中点锚定） */
  resizeWindow: (width: number, height: number) => void
  quit: () => void
}

const skyi: SkyiApi = {
  getRuntime: () => ipcRenderer.invoke('skyi:get-runtime'),
  setPassthrough: (on) => ipcRenderer.send('skyi:set-passthrough', on),
  listModels: () => ipcRenderer.invoke('skyi:list-models'),
  pickModelDir: () => ipcRenderer.invoke('skyi:pick-model-dir'),
  moveWindow: (dx, dy) => ipcRenderer.send('skyi:move-window', dx, dy),
  moveWindowEnd: () => ipcRenderer.send('skyi:move-window-end'),
  resizeWindow: (width, height) => ipcRenderer.send('skyi:resize-window', width, height),
  quit: () => ipcRenderer.send('skyi:quit')
}

contextBridge.exposeInMainWorld('skyi', skyi)

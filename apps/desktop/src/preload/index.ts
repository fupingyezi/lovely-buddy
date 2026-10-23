import { contextBridge, ipcRenderer } from 'electron'

export interface Runtime {
  baseUrl: string
  token: string
  dev: boolean
}

export interface LovelybuddyApi {
  /** 获取后端地址与鉴权 token（打包模式由主进程随机生成） */
  getRuntime: () => Promise<Runtime>
  /** 点击穿透开关（forward:true） */
  setPassthrough: (on: boolean) => void
  /** 弹出本地文件/目录选择框（zip 或目录），返回路径或 canceled */
  pickImportPath: (mode: 'zip' | 'dir') => Promise<{ canceled: boolean; path: string | null }>
  /** 拖拽：按屏幕坐标增量移动窗口（主进程夹紧在屏幕内） */
  moveWindow: (dx: number, dy: number) => void
  /** 拖拽结束：持久化窗口位置 */
  moveWindowEnd: () => void
  /** 模型加载后按显示尺寸调整窗口（底部中点锚定） */
  resizeWindow: (width: number, height: number) => void
  /** 面板打开：向左上扩展窗口（右下角固定，key 记账可多面板共存），返回扩展后实际尺寸 */
  expandWindow: (key: string, extraWidth: number, extraHeight: number) => Promise<{ width: number; height: number }>
  /** 面板关闭：去掉该 key 的扩展量，全部关闭后缩回基准（右下角固定） */
  collapseWindow: (key: string) => void
  quit: () => void
}

const lovelybuddy: LovelybuddyApi = {
  getRuntime: () => ipcRenderer.invoke('lovelybuddy:get-runtime'),
  setPassthrough: (on) => ipcRenderer.send('lovelybuddy:set-passthrough', on),
  pickImportPath: (mode) => ipcRenderer.invoke('lovelybuddy:pick-import-path', mode),
  moveWindow: (dx, dy) => ipcRenderer.send('lovelybuddy:move-window', dx, dy),
  moveWindowEnd: () => ipcRenderer.send('lovelybuddy:move-window-end'),
  resizeWindow: (width, height) => ipcRenderer.send('lovelybuddy:resize-window', width, height),
  expandWindow: (key, extraWidth, extraHeight) =>
    ipcRenderer.invoke('lovelybuddy:expand-window', key, extraWidth, extraHeight),
  collapseWindow: (key) => ipcRenderer.send('lovelybuddy:collapse-window', key),
  quit: () => ipcRenderer.send('lovelybuddy:quit')
}

contextBridge.exposeInMainWorld('lovelybuddy', lovelybuddy)

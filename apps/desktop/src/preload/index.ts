import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CHANNELS } from '../bridge/channels'

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
  /** 导出文本文件：主进程弹保存对话框（默认 Downloads）并写入，返回保存结果 */
  exportFile: (defaultName: string, content: string) => Promise<{ saved: boolean; path: string | null }>
  /** 拖拽：按屏幕坐标增量移动窗口（主进程夹紧在屏幕内） */
  moveWindow: (dx: number, dy: number) => void
  /** 拖拽结束：持久化窗口位置 */
  moveWindowEnd: () => void
  /** 模型加载后按显示尺寸调整窗口（底部中点锚定） */
  resizeWindow: (width: number, height: number) => void
  /** 面板打开：向左上扩展窗口（右下角固定，key 记账可多面板共存），返回扩展后实际尺寸 */
  expandWindow: (key: string, extraWidth: number, extraHeight: number) => Promise<{ width: number; height: number }>
  /** 菜单展开：主进程按当前真实窗口尺寸计算扩展量，返回扩展后实际尺寸 */
  expandMenu: (requiredW: number, requiredH: number) => Promise<{ width: number; height: number }>
  /** 面板关闭：去掉该 key 的扩展量，全部关闭后缩回基准（右下角固定） */
  collapseWindow: (key: string) => void
  /** 打开独立无边框设置窗口（已开则聚焦） */
  openSettings: () => Promise<void>
  /** 关闭当前设置窗口（Esc / 标题条关闭按钮） */
  closeSettings: () => void
  /** 设置窗口清空对话后通知主进程（主进程广播给桌宠窗口刷新历史） */
  notifyChatCleared: () => void
  /** 订阅「设置窗口清空对话」广播，返回退订函数 */
  onChatCleared: (cb: () => void) => () => void
  /** 拖拽文件/文件夹取绝对路径（Electron 32+ 移除 File.path，用 webUtils） */
  getPathForFile: (file: File) => string
  /** 设置窗口导入/删除形象后通知主进程（主进程广播给桌宠窗口刷新形象列表） */
  notifyModelsChanged: () => void
  /** 订阅「形象列表变更」广播，返回退订函数 */
  onModelsChanged: (cb: () => void) => () => void
  quit: () => void
}

const lovelybuddy: LovelybuddyApi = {
  getRuntime: () => ipcRenderer.invoke(CHANNELS.getRuntime),
  setPassthrough: (on) => ipcRenderer.send(CHANNELS.setPassthrough, on),
  pickImportPath: (mode) => ipcRenderer.invoke(CHANNELS.pickImportPath, mode),
  exportFile: (defaultName, content) => ipcRenderer.invoke(CHANNELS.exportFile, defaultName, content),
  moveWindow: (dx, dy) => ipcRenderer.send(CHANNELS.moveWindow, dx, dy),
  moveWindowEnd: () => ipcRenderer.send(CHANNELS.moveWindowEnd),
  resizeWindow: (width, height) => ipcRenderer.send(CHANNELS.resizeWindow, width, height),
  expandWindow: (key, extraWidth, extraHeight) =>
    ipcRenderer.invoke(CHANNELS.expandWindow, key, extraWidth, extraHeight),
  expandMenu: (requiredW, requiredH) => ipcRenderer.invoke(CHANNELS.expandMenu, requiredW, requiredH),
  collapseWindow: (key) => ipcRenderer.send(CHANNELS.collapseWindow, key),
  openSettings: () => ipcRenderer.invoke(CHANNELS.openSettings),
  closeSettings: () => ipcRenderer.send(CHANNELS.closeSettings),
  notifyChatCleared: () => ipcRenderer.send(CHANNELS.notifyChatCleared),
  onChatCleared: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(CHANNELS.chatCleared, listener)
    return () => ipcRenderer.removeListener(CHANNELS.chatCleared, listener)
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  notifyModelsChanged: () => ipcRenderer.send(CHANNELS.notifyModelsChanged),
  onModelsChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(CHANNELS.modelsChanged, listener)
    return () => ipcRenderer.removeListener(CHANNELS.modelsChanged, listener)
  },
  quit: () => ipcRenderer.send(CHANNELS.quit)
}

contextBridge.exposeInMainWorld('lovelybuddy', lovelybuddy)

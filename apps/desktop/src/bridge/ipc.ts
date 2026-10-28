import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { CHANNELS } from './channels'
import type { PetWindowManager } from '../window/manager'
import type { createSettingsWindow } from '../window/settings'

// dev 模式固定值（make dev 时 Go 监听 8740）；打包模式由 goProcess 动态生成（M4 实现）
const DEV_ADDR = process.env.LOVELYBUDDY_ADDR ?? '127.0.0.1:8740'
const DEV_TOKEN = process.env.LOVELYBUDDY_DEV_TOKEN ?? 'dev'

/** 注册全部 lovelybuddy:* 频道：只做转发，窗口/设置操作落在 window/manager 与 window/settings。 */
export function setupIPC(win: PetWindowManager, settingsWin: ReturnType<typeof createSettingsWindow>): void {
  ipcMain.handle(CHANNELS.getRuntime, () => ({
    baseUrl: `http://${DEV_ADDR}`,
    token: DEV_TOKEN,
    dev: !app.isPackaged
  }))
  ipcMain.on(CHANNELS.setPassthrough, (_e, on: boolean) => win.setPassthrough(on))
  // 拖拽 = 移动窗口（增量），夹紧与持久化都在 manager
  ipcMain.on(CHANNELS.moveWindow, (_e, dx: number, dy: number) => win.moveBy(dx, dy))
  ipcMain.on(CHANNELS.moveWindowEnd, () => win.endMove())
  // 模型加载后按模型显示尺寸调整窗口
  ipcMain.on(CHANNELS.resizeWindow, (_e, width: number, height: number) => win.resizeToModel(width, height))
  // 面板打开/关闭：expand 向左上扩、collapse 去掉该面板扩展量（右下角固定，多面板共存）
  ipcMain.handle(CHANNELS.expandWindow, (_e, key: string, extraWidth: number, extraHeight: number) =>
    win.expandFor(key, extraWidth, extraHeight)
  )
  ipcMain.on(CHANNELS.collapseWindow, (_e, key: string) => win.collapseFor(key))
  // 菜单展开：主进程按真实 bounds 计算扩展量（渲染进程 innerWidth 落后 resize 事件，
  // 连续 Cmd+点击会读到过期宽度导致菜单被截断）
  ipcMain.handle(CHANNELS.expandMenu, (_e, requiredW: number, requiredH: number) =>
    win.expandForMenu(requiredW, requiredH)
  )
  ipcMain.on(CHANNELS.quit, () => app.quit())
  // 设置窗口：独立无边框窗口（复用同一渲染进程 ?settings=1），已开则聚焦
  ipcMain.handle(CHANNELS.openSettings, () => settingsWin.open())
  ipcMain.on(CHANNELS.closeSettings, (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  // 设置窗口清空对话 → 广播给桌宠窗口刷新历史（首个 main→renderer 推送）
  ipcMain.on(CHANNELS.notifyChatCleared, () => {
    win.window?.webContents.send(CHANNELS.chatCleared)
  })
  // 设置窗口导入/删除形象 → 广播给桌宠窗口刷新形象列表（同 chat-cleared 跨窗同步模式）
  ipcMain.on(CHANNELS.notifyModelsChanged, () => {
    win.window?.webContents.send(CHANNELS.modelsChanged)
  })
  // 本地导入：选择 zip 文件或目录（实际导入由 Go 后端执行，这里只取路径）
  // any=zip 文件或目录二选一（macOS 同框可同时选；Windows 该组合退化为目录选择）
  ipcMain.handle(CHANNELS.pickImportPath, async (e, mode: 'zip' | 'dir' | 'any') => {
    const opts: Electron.OpenDialogOptions =
      mode === 'dir'
        ? { title: '选择形象目录', properties: ['openDirectory'] }
        : mode === 'any'
          ? {
              title: '选择形象 zip 或目录',
              properties: ['openFile', 'openDirectory'],
              filters: [{ name: 'Zip', extensions: ['zip'] }]
            }
          : { title: '选择形象 zip', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] }
    // 对话框挂在发起窗口（设置窗口导出的场景没有桌宠窗口上下文）
    const parent = BrowserWindow.fromWebContents(e.sender) ?? win.window
    if (!parent) return { canceled: true, path: null }
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, opts)
    if (canceled || filePaths.length === 0) return { canceled: true, path: null }
    return { canceled: false, path: filePaths[0] }
  })
  // 导出文本文件（对话记录 Markdown）：保存对话框默认 Downloads/<name>，用户取消不写
  ipcMain.handle(CHANNELS.exportFile, async (e, defaultName: string, content: string) => {
    const parent = BrowserWindow.fromWebContents(e.sender) ?? win.window
    if (!parent) return { saved: false, path: null }
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: '导出对话记录',
      defaultPath: join(app.getPath('downloads'), defaultName),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return { saved: false, path: null }
    await writeFile(filePath, content, 'utf-8')
    return { saved: true, path: filePath }
  })
  // 关于页：真实运行时信息（版本取 app.getVersion，不虚构）
  ipcMain.handle(CHANNELS.getAppInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData')
  }))
  // 外部链接（关于页）：仅 http/https 白名单
  ipcMain.on(CHANNELS.openExternal, (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}

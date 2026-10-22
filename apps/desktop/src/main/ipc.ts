import { app, dialog, ipcMain } from 'electron'
import type { PetWindowManager } from './window/manager'

// dev 模式固定值（make dev 时 Go 监听 8740）；打包模式由 goProcess 动态生成（M4 实现）
const DEV_ADDR = process.env.LOVELYBUDDY_ADDR ?? '127.0.0.1:8740'
const DEV_TOKEN = process.env.LOVELYBUDDY_DEV_TOKEN ?? 'dev'

/** 注册全部 lovelybuddy:* 频道：只做转发，窗口/设置操作落在 windowManager。 */
export function setupIPC(win: PetWindowManager): void {
  ipcMain.handle('lovelybuddy:get-runtime', () => ({
    baseUrl: `http://${DEV_ADDR}`,
    token: DEV_TOKEN,
    dev: !app.isPackaged
  }))
  ipcMain.on('lovelybuddy:set-passthrough', (_e, on: boolean) => win.setPassthrough(on))
  // 拖拽 = 移动窗口（增量），夹紧与持久化都在 manager
  ipcMain.on('lovelybuddy:move-window', (_e, dx: number, dy: number) => win.moveBy(dx, dy))
  ipcMain.on('lovelybuddy:move-window-end', () => win.endMove())
  // 模型加载后按模型显示尺寸调整窗口
  ipcMain.on('lovelybuddy:resize-window', (_e, width: number, height: number) => win.resizeToModel(width, height))
  // 菜单打开/关闭：expand 向左上扩、collapse 缩回基准（右下角固定）
  ipcMain.handle('lovelybuddy:expand-window', (_e, extraWidth: number, extraHeight: number) => win.expand(extraWidth, extraHeight))
  ipcMain.on('lovelybuddy:collapse-window', () => win.collapse())
  ipcMain.on('lovelybuddy:quit', () => app.quit())
  // 本地导入：选择 zip 文件或目录（实际导入由 Go 后端执行，这里只取路径）
  ipcMain.handle('lovelybuddy:pick-import-path', async (_e, mode: 'zip' | 'dir') => {
    const opts: Electron.OpenDialogOptions =
      mode === 'dir'
        ? { title: '选择形象目录', properties: ['openDirectory'] }
        : { title: '选择形象 zip', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] }
    const { canceled, filePaths } = await dialog.showOpenDialog(win.window!, opts)
    if (canceled || filePaths.length === 0) return { canceled: true, path: null }
    return { canceled: false, path: filePaths[0] }
  })
}

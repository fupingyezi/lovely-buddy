import { app, BrowserWindow } from 'electron'
import { registerScheme, registerL2DProtocol } from '../bridge/protocol'
import { SettingsStore } from './settings-store'
import { setupCSP } from './csp'
import { setupIPC } from '../bridge/ipc'
import { createTray } from './tray'
import { PetWindowManager } from '../window/manager'
import { createSettingsWindow } from '../window/settings'

// 组装根：特权协议必须在 app.ready 之前注册
registerScheme()

const settings = new SettingsStore()
const windows = new PetWindowManager(settings)
const settingsWin = createSettingsWindow(() => windows.window)

app.whenReady().then(() => {
  settings.load()
  setupCSP()
  setupIPC(windows, settingsWin)
  registerL2DProtocol(() => settings.modelDir)
  windows.create()
  createTray(() => windows.window)
  app.dock?.hide() // 桌宠常驻托盘，不占 Dock

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.create()
  })
})

// 托盘应用：关窗不退出
app.on('window-all-closed', () => {
  /* 保持存活，退出走托盘菜单 */
})

import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

/** 设置窗口尺寸（8:5 比例，正常桌面应用大小） */
export const SETTINGS_W = 960
export const SETTINGS_H = 600
const SETTINGS_MIN_W = 720
const SETTINGS_MIN_H = 480

/**
 * 独立无边框设置窗口（仿 Codex/DSH 桌面端）：与桌宠窗口共用同一渲染进程
 * （?settings=1 分支）与 preload。单例引用：已开则 show+focus，closed 清引用。
 * 关设置窗不影响应用生命周期（index.ts 的 window-all-closed 本就托盘常驻不退出）。
 * 无边框窗口的拖拽/关闭由渲染进程自绘（.settings-titlebar 的 -webkit-app-region: drag
 * + .settings-close 按钮），主进程只提供 open/close IPC。
 */
export function createSettingsWindow(getPet: () => BrowserWindow | null): { open: () => void } {
  let win: BrowserWindow | null = null

  const open = (): void => {
    if (win !== null) {
      win.show()
      win.focus()
      return
    }
    // 在桌宠所在显示器居中；桌宠不在则主屏居中
    const pet = getPet()
    const display = pet ? screen.getDisplayMatching(pet.getBounds()) : screen.getPrimaryDisplay()
    const { x, y, width: waW, height: waH } = display.workArea
    win = new BrowserWindow({
      x: x + Math.round((waW - SETTINGS_W) / 2),
      y: y + Math.round((waH - SETTINGS_H) / 2),
      width: SETTINGS_W,
      height: SETTINGS_H,
      minWidth: SETTINGS_MIN_W,
      minHeight: SETTINGS_MIN_H,
      frame: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'AI桌宠设置',
      backgroundColor: '#fbf7f0', // 防白闪（与 tokens --color-bg 一致）
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    win.once('ready-to-show', () => win?.show())
    win.on('closed', () => {
      win = null
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?settings=1`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { settings: '1' } })
    }
  }

  return { open }
}

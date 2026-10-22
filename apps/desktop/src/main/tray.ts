import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'

export function createTray(getWindow: () => BrowserWindow | null): Tray {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/trayTemplate.png'))
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  const tray = new Tray(icon)
  tray.setToolTip('AI桌宠')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示/隐藏桌宠',
        click: () => {
          const w = getWindow()
          if (w) w.isVisible() ? w.hide() : w.show()
        }
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  )
  return tray
}

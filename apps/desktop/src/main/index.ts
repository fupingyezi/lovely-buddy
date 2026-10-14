import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, Tray } from 'electron'
import { join } from 'node:path'

// dev 模式固定值（make dev 时 Go 监听 8740）；打包模式由 goProcess 动态生成（M4 实现）
const DEV_ADDR = process.env.SKYI_ADDR ?? '127.0.0.1:8740'
const DEV_TOKEN = process.env.SKYI_DEV_TOKEN ?? 'dev'

let petWindow: BrowserWindow | null = null
let tray: Tray | null = null

// CSP 以响应头注入（不用 index.html meta）：dev 需要放行 Vite HMR 的内联脚本，打包后收紧。
function setupCSP(): void {
  const dev = !app.isPackaged
  const scriptSrc = dev ? "'self' 'unsafe-inline'" : "'self'"
  const connectSrc = [
    "'self'",
    'http://127.0.0.1:*',
    'ws://127.0.0.1:*',
    'l2d:',
    ...(dev ? ['http://localhost:5173', 'ws://localhost:5173'] : [])
  ].join(' ')
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' l2d: data: blob:",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

function createPetWindow(): void {
  // 覆盖整个 workArea 而非 fullscreen（macOS fullscreen 会进独立 Space 抢焦点）
  const { workArea } = screen.getPrimaryDisplay()
  petWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  petWindow.setAlwaysOnTop(true, 'screen-saver')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.once('ready-to-show', () => petWindow?.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void petWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void petWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/trayTemplate.png'))
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('天依桌宠')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示/隐藏桌宠',
        click: () => (petWindow?.isVisible() ? petWindow.hide() : petWindow?.show())
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  )
}

function setupIPC(): void {
  ipcMain.handle('skyi:get-runtime', () => ({
    baseUrl: `http://${DEV_ADDR}`,
    token: DEV_TOKEN,
    dev: !app.isPackaged
  }))
  ipcMain.on('skyi:set-passthrough', (_e, on: boolean) => {
    // forward:true 保住 mousemove，否则窗口一旦穿透就再也收不到鼠标事件、无法关闭穿透
    petWindow?.setIgnoreMouseEvents(!!on, { forward: true })
  })
  ipcMain.on('skyi:quit', () => app.quit())
}

app.whenReady().then(() => {
  setupCSP()
  setupIPC()
  createPetWindow()
  createTray()
  app.dock?.hide() // 桌宠常驻托盘，不占 Dock

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

// 托盘应用：关窗不退出
app.on('window-all-closed', () => {
  /* 保持存活，退出走托盘菜单 */
})

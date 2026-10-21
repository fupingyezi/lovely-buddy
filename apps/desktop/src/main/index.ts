import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, session, Tray } from 'electron'
import { join } from 'node:path'
import { registerScheme, registerL2DProtocol } from './protocol'
import { SettingsStore } from './store'

// dev 模式固定值（make dev 时 Go 监听 8740）；打包模式由 goProcess 动态生成（M4 实现）
const DEV_ADDR = process.env.LOVELYBUDDY_ADDR ?? '127.0.0.1:8740'
const DEV_TOKEN = process.env.LOVELYBUDDY_DEV_TOKEN ?? 'dev'

// 特权协议必须在 app.ready 之前注册
registerScheme()

const settings = new SettingsStore()
let petWindow: BrowserWindow | null = null
let tray: Tray | null = null
// 菜单展开前的窗口基准 bounds（缩回时右下角固定，角色屏幕位置不动）
let expandedBase: Electron.Rectangle | null = null

// 桌宠窗口只包住模型本身（不是全屏玻璃）：默认 420x480（无模型时的占位），模型加载后按模型尺寸调整
const WIN_W = 420
const WIN_H = 480
// 模型窗口的最小地板（防退化模型算出 0 尺寸），正常模型远大于此
const MIN_W = 60
const MIN_H = 90

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

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
    "media-src 'self' l2d:", // 模型动作自带音效（v1 无 TTS，音效走 l2d://）
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

/** 已保存的窗口位置若在当前屏幕内可用则恢复，否则回默认（贴底部居中）。 */
function initialWindowBounds(workArea: Electron.Rectangle): { x: number; y: number } {
  const saved = settings.windowPos
  const inScreen =
    saved !== null &&
    saved.x >= workArea.x - WIN_W / 2 &&
    saved.x <= workArea.x + workArea.width - WIN_W / 2 &&
    saved.y >= workArea.y - 64 &&
    saved.y <= workArea.y + workArea.height - 64
  return inScreen
    ? { x: saved.x, y: saved.y }
    : {
        x: Math.round(workArea.x + (workArea.width - WIN_W) / 2),
        y: Math.round(workArea.y + workArea.height - WIN_H)
      }
}

function createPetWindow(): void {
  // 小窗口只包住模型：不像全屏玻璃那样盖住桌面，点不到其他应用的问题从根上消失。
  // 窗口内部仍保留穿透开关：默认穿透，指针在模型/面板上才恢复交互。
  const { workArea } = screen.getPrimaryDisplay()
  const { x, y } = initialWindowBounds(workArea)
  petWindow = new BrowserWindow({
    x,
    y,
    width: WIN_W,
    height: WIN_H,
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
  // 创建即穿透：renderer 就绪前点击全部直达桌面，绝不吞鼠标
  petWindow.setIgnoreMouseEvents(true, { forward: true })
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
  ipcMain.handle('lovelybuddy:get-runtime', () => ({
    baseUrl: `http://${DEV_ADDR}`,
    token: DEV_TOKEN,
    dev: !app.isPackaged
  }))
  ipcMain.on('lovelybuddy:set-passthrough', (_e, on: boolean) => {
    // forward:true 保住 mousemove，否则窗口一旦穿透就再也收不到鼠标事件、无法关闭穿透
    petWindow?.setIgnoreMouseEvents(!!on, { forward: true })
  })
  // 拖拽 = 移动窗口（增量），主进程按当前屏幕夹紧，防止拖出屏幕外找不回来
  ipcMain.on('lovelybuddy:move-window', (_e, dx: number, dy: number) => {
    if (!petWindow) return
    const [wx, wy] = petWindow.getPosition()
    const [w, h] = petWindow.getSize()
    const wa = screen.getDisplayMatching(petWindow.getBounds()).workArea
    petWindow.setPosition(clamp(wx + Math.round(dx), wa.x, wa.x + wa.width - w), clamp(wy + Math.round(dy), wa.y, wa.y + wa.height - h))
  })
  // 拖拽结束 → 持久化窗口位置
  ipcMain.on('lovelybuddy:move-window-end', () => {
    if (!petWindow) return
    const [x, y] = petWindow.getPosition()
    settings.saveWindowPos(x, y)
  })
  // 模型加载后按模型显示尺寸调整窗口（底部中点锚定，脚不跳）
  ipcMain.on('lovelybuddy:resize-window', (_e, width: number, height: number) => {
    if (!petWindow) return
    const wa = screen.getDisplayMatching(petWindow.getBounds()).workArea
    const w = clamp(Math.round(width), MIN_W, wa.width)
    const h = clamp(Math.round(height), MIN_H, wa.height)
    const [wx, wy] = petWindow.getPosition()
    const [cw, ch] = petWindow.getSize()
    petWindow.setBounds({ x: Math.round(wx + cw / 2 - w / 2), y: Math.round(wy + ch - h), width: w, height: h })
    // 展开态下切模型会触发 resize：基准随新尺寸更新，缩回时不会跳回旧尺寸
    if (expandedBase) expandedBase = petWindow.getBounds()
  })
  // 菜单打开：窗口向左上扩展容纳菜单（右下角固定，角色屏幕位置不动；屏幕边缘夹紧）
  ipcMain.handle('lovelybuddy:expand-window', (_e, extraWidth: number, extraHeight: number) => {
    if (!petWindow) return { width: 0, height: 0 }
    if (!expandedBase) expandedBase = petWindow.getBounds()
    const b = petWindow.getBounds()
    const wa = screen.getDisplayMatching(b).workArea
    const x = Math.max(wa.x, b.x - extraWidth)
    const y = Math.max(wa.y, b.y - extraHeight)
    const width = b.width + (b.x - x)
    const height = b.height + (b.y - y)
    petWindow.setBounds({ x, y, width, height })
    return { width, height }
  })
  // 菜单关闭：缩回基准尺寸（右下角固定），角色位置不变
  ipcMain.on('lovelybuddy:collapse-window', () => {
    if (!petWindow || !expandedBase) return
    const b = petWindow.getBounds()
    petWindow.setBounds({
      x: b.x + (b.width - expandedBase.width),
      y: b.y + (b.height - expandedBase.height),
      width: expandedBase.width,
      height: expandedBase.height
    })
    expandedBase = null
  })
  ipcMain.on('lovelybuddy:quit', () => app.quit())
  // 本地导入：选择 zip 文件或目录（实际导入由 Go 后端执行，这里只取路径）
  ipcMain.handle('lovelybuddy:pick-import-path', async (_e, mode: 'zip' | 'dir') => {
    const opts: Electron.OpenDialogOptions =
      mode === 'dir'
        ? { title: '选择形象目录', properties: ['openDirectory'] }
        : { title: '选择形象 zip', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] }
    const { canceled, filePaths } = await dialog.showOpenDialog(petWindow!, opts)
    if (canceled || filePaths.length === 0) return { canceled: true, path: null }
    return { canceled: false, path: filePaths[0] }
  })
}

app.whenReady().then(() => {
  settings.load()
  setupCSP()
  setupIPC()
  registerL2DProtocol(() => settings.modelDir)
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

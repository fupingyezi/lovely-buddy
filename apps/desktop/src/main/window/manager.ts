import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { WIN_H, WIN_W, collapseBounds, expandBounds, initialBounds, modelResizeBounds, moveBounds, type Rect } from './bounds'
import type { SettingsStore } from '../store'

/**
 * 桌宠窗口生命周期与 bounds 状态机：唯一持有窗口引用和展开基准 expandedBase 的地方。
 * 桌宠窗口只包住模型本身（不是全屏玻璃）：默认 420x480 占位，模型加载后按模型尺寸调整；
 * 锚定/夹紧数学见 bounds.ts。
 */
export class PetWindowManager {
  private win: BrowserWindow | null = null
  // 菜单展开前的窗口基准 bounds（缩回时右下角固定，角色屏幕位置不动）
  private expandedBase: Rect | null = null

  constructor(private readonly settings: SettingsStore) {}

  get window(): BrowserWindow | null {
    return this.win
  }

  create(): void {
    // 窗口内部仍保留穿透开关：默认穿透，指针在模型/面板上才恢复交互
    const { workArea } = screen.getPrimaryDisplay()
    const { x, y } = initialBounds(this.settings.windowPos, workArea)
    this.win = new BrowserWindow({
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
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // 创建即穿透：renderer 就绪前点击全部直达桌面，绝不吞鼠标
    this.win.setIgnoreMouseEvents(true, { forward: true })
    this.win.once('ready-to-show', () => this.win?.show())

    if (process.env['ELECTRON_RENDERER_URL']) {
      void this.win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void this.win.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  /** forward:true 保住 mousemove，否则窗口一旦穿透就再也收不到鼠标事件、无法关闭穿透 */
  setPassthrough(on: boolean): void {
    this.win?.setIgnoreMouseEvents(on, { forward: true })
  }

  /** 拖拽 = 增量移动，按当前屏幕夹紧，防止拖出屏幕外找不回来 */
  moveBy(dx: number, dy: number): void {
    const w = this.win
    if (!w) return
    const [wx, wy] = w.getPosition()
    const [width, height] = w.getSize()
    const wa = screen.getDisplayMatching(w.getBounds()).workArea
    const next = moveBounds({ x: wx, y: wy }, { width, height }, dx, dy, wa)
    w.setPosition(next.x, next.y)
  }

  /** 拖拽结束 → 持久化窗口位置 */
  endMove(): void {
    if (!this.win) return
    const [x, y] = this.win.getPosition()
    this.settings.saveWindowPos(x, y)
  }

  /** 模型加载后按模型显示尺寸调整窗口（底部中点锚定，脚不跳） */
  resizeToModel(width: number, height: number): void {
    const w = this.win
    if (!w) return
    const wa = screen.getDisplayMatching(w.getBounds()).workArea
    w.setBounds(modelResizeBounds(w.getBounds(), width, height, wa))
    // 展开态下切模型会触发 resize：基准随新尺寸更新，缩回时不会跳回旧尺寸
    if (this.expandedBase) this.expandedBase = w.getBounds()
  }

  /** 菜单打开：窗口向左上扩展容纳菜单（右下角固定），屏幕边缘夹紧 */
  expand(extraWidth: number, extraHeight: number): { width: number; height: number } {
    const w = this.win
    if (!w) return { width: 0, height: 0 }
    if (!this.expandedBase) this.expandedBase = w.getBounds()
    const wa = screen.getDisplayMatching(w.getBounds()).workArea
    const next = expandBounds(w.getBounds(), extraWidth, extraHeight, wa)
    w.setBounds(next)
    return { width: next.width, height: next.height }
  }

  /** 菜单关闭：缩回基准尺寸（右下角固定），角色位置不变 */
  collapse(): void {
    const w = this.win
    if (!w || !this.expandedBase) return
    w.setBounds(collapseBounds(w.getBounds(), this.expandedBase))
    this.expandedBase = null
  }
}

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface SkyiSettings {
  /** 用户选择的模型根目录；null = 使用默认值 */
  modelDir: string | null
  /** 上次桌宠窗口位置（拖拽后持久化） */
  windowPos: { x: number; y: number } | null
}

const defaults: SkyiSettings = { modelDir: null, windowPos: null }

/** 主进程最小 JSON 设置存储（userData/settings.json）。 */
export class SettingsStore {
  private readonly file = join(app.getPath('userData'), 'settings.json')
  private data: SkyiSettings = { ...defaults }

  load(): void {
    try {
      if (existsSync(this.file)) {
        this.data = { ...defaults, ...(JSON.parse(readFileSync(this.file, 'utf8')) as SkyiSettings) }
      }
    } catch {
      // 文件损坏时回退默认，不阻塞启动
      this.data = { ...defaults }
    }
  }

  save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  /** 模型根目录：用户选择 > dev=仓库 model/ > packaged=userData/models */
  get modelDir(): string {
    if (this.data.modelDir) return this.data.modelDir
    return app.isPackaged ? join(app.getPath('userData'), 'models') : join(app.getAppPath(), '..', '..', 'model')
  }

  setModelDir(dir: string | null): void {
    this.data.modelDir = dir
    this.save()
  }

  get windowPos(): { x: number; y: number } | null {
    return this.data.windowPos
  }

  saveWindowPos(x: number, y: number): void {
    this.data.windowPos = { x, y }
    this.save()
  }
}

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface LovelybuddySettings {
  /** 上次桌宠窗口位置（拖拽后持久化） */
  windowPos: { x: number; y: number } | null
}

const defaults: LovelybuddySettings = { windowPos: null }

/** 主进程最小 JSON 设置存储（userData/settings.json）。 */
export class SettingsStore {
  private readonly file = join(app.getPath('userData'), 'settings.json')
  private data: LovelybuddySettings = { ...defaults }

  load(): void {
    try {
      if (existsSync(this.file)) {
        this.data = { ...defaults, ...(JSON.parse(readFileSync(this.file, 'utf8')) as LovelybuddySettings) }
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

  /** 模型根目录（l2d:// 服务根）：dev=仓库 model/，packaged=userData/models。
   *  目录选择入口已移除，唯一根与 Go 后端（--model-dir 默认 ../model）同指一处。 */
  get modelDir(): string {
    return app.isPackaged ? join(app.getPath('userData'), 'models') : join(app.getAppPath(), '..', '..', 'model')
  }

  get windowPos(): { x: number; y: number } | null {
    return this.data.windowPos
  }

  saveWindowPos(x: number, y: number): void {
    this.data.windowPos = { x, y }
    this.save()
  }
}

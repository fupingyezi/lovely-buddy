import type { AvatarActions } from '@/live2d/motion/actions'

// window.lovelybuddy 由 preload 通过 contextBridge 注入（保持与 src/preload/index.ts 的 LovelybuddyApi 一致）
declare global {
  interface ModelInfo {
    name: string
    url: string
    kind: 'moc' | 'moc3'
  }

  interface AvatarInfo extends ModelInfo {
    /** 形象目录名（服务端唯一标识） */
    slug: string
    /** 相对模型根目录的入口文件 */
    entry: string
    author?: string
    version?: string
    license?: string
    homepage?: string
    /** 来源：导入写入（local/url），手工放入为空 */
    source?: 'local' | 'url'
    /** 模型包体积（字节，服务端探测统计） */
    sizeBytes?: number
    /** 表情组数量（入口 json Expressions 长度） */
    expressions?: number
    /** avatar.json 的动作映射（服务端透传，意图解析时按能力目录降级） */
    actions?: AvatarActions
  }

  interface LovelybuddyApi {
    getRuntime: () => Promise<{ baseUrl: string; token: string; dev: boolean }>
    setPassthrough: (on: boolean) => void
    /** 弹出本地文件/目录选择框（zip 或目录），返回路径或 canceled */
    pickImportPath: (mode: 'zip' | 'dir') => Promise<{ canceled: boolean; path: string | null }>
    /** 导出文本文件：主进程弹保存对话框（默认 Downloads）并写入，返回保存结果 */
    exportFile: (defaultName: string, content: string) => Promise<{ saved: boolean; path: string | null }>
    moveWindow: (dx: number, dy: number) => void
    moveWindowEnd: () => void
    resizeWindow: (width: number, height: number) => void
    /** 面板打开：向左上扩展窗口（右下角固定，key 记账可多面板共存），返回扩展后实际尺寸 */
    expandWindow: (key: string, extraWidth: number, extraHeight: number) => Promise<{ width: number; height: number }>
    /** 菜单展开：主进程按当前真实窗口尺寸计算扩展量，返回扩展后实际尺寸 */
    expandMenu: (requiredW: number, requiredH: number) => Promise<{ width: number; height: number }>
    /** 面板关闭：去掉该 key 的扩展量，全部关闭后缩回基准（右下角固定） */
    collapseWindow: (key: string) => void
    /** 打开独立无边框设置窗口（已开则聚焦） */
    openSettings: () => Promise<void>
    /** 关闭当前设置窗口（Esc / 标题条关闭按钮） */
    closeSettings: () => void
    /** 设置窗口清空对话后通知主进程（主进程广播给桌宠窗口刷新历史） */
    notifyChatCleared: () => void
    /** 订阅「设置窗口清空对话」广播，返回退订函数 */
    onChatCleared: (cb: () => void) => () => void
    /** 拖拽文件/文件夹取绝对路径（Electron 32+ 移除 File.path，用 webUtils） */
    getPathForFile: (file: File) => string
    /** 设置窗口导入/删除形象后通知主进程（主进程广播给桌宠窗口刷新形象列表） */
    notifyModelsChanged: () => void
    /** 订阅「形象列表变更」广播，返回退订函数 */
    onModelsChanged: (cb: () => void) => () => void
    quit: () => void
  }

  interface Window {
    lovelybuddy: LovelybuddyApi
    // Cubism core UMD 全局（live2d/engine/loader.ts 动态注入），pixi-live2d-display 依赖
    PIXI?: unknown
    Live2D?: unknown
    Live2DCubismCore?: unknown
  }
}

export {}

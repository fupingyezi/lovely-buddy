import { useEffect, type ReactElement } from 'react'
import SettingsPanel from './SettingsPanel'
import { useChatStore } from '../../store/chatStore'
import { usePetStore } from '../../store/petStore'

/**
 * 独立设置窗口根组件（主进程 ?settings=1 分支）：不加载 PIXI/模型/健康轮询。
 * 挂载即拉对话历史（独立 renderer 进程，store 不共享）；Esc 关闭窗口；
 * 无边框窗口的拖拽区与关闭按钮见 .settings-titlebar。
 */
export default function SettingsApp(): ReactElement {
  useEffect(() => {
    void useChatStore.getState().refresh()
  }, [])

  useEffect(() => {
    void usePetStore.getState().loadModels()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.lovelybuddy.closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <header
        className="settings-titlebar shrink-0 h-10 flex items-center justify-between pl-(--sp-3) bg-bg select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="text-ink-2 text-(--fs-aux)">设置</span>
        <button
          type="button"
          className="settings-close w-10 h-10 flex items-center justify-center bg-transparent text-ink-2 text-lg cursor-pointer transition-[color,background] duration-[120ms] ease-standard hover:text-ink hover:bg-hover-bg"
          title="关闭"
          onClick={() => window.lovelybuddy.closeSettings()}
        >
          ×
        </button>
      </header>
      <SettingsPanel />
    </div>
  )
}

import { useEffect, useRef, type ReactElement } from 'react'
import PetCanvas from './pet/PetCanvas'
import PetMenu from './pet/PetMenu'
import ImportPanel from './pet/ImportPanel'
import ChatPanel from './pet/chat/ChatPanel'
import SpeechBubble from './pet/chat/SpeechBubble'
import { useChatPanel } from './hooks/useChatPanel'
import { usePetMenu } from './hooks/usePetMenu'
import { usePetStore } from './store/petStore'
import { useChatStore } from './store/chatStore'
import { useWindowGeometrySync } from './live2d/windowGeometry'

export default function App(): ReactElement {
  const modelUrl = usePetStore((s) => s.modelUrl)
  const modelName = usePetStore((s) => s.modelName)
  const placeholderDismissed = usePetStore((s) => s.placeholderDismissed)
  const loadModels = usePetStore((s) => s.loadModels)
  const dismissPlaceholder = usePetStore((s) => s.dismissPlaceholder)
  const { menuOpen, openMenu, closeMenu } = usePetMenu()
  const { open: chatOpen, openPanel } = useChatPanel()
  useWindowGeometrySync()

  // 后端健康轮询（5s）
  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      try {
        const runtime = await window.lovelybuddy.getRuntime()
        if (stopped) return
        const res = await fetch(`${runtime.baseUrl}/healthz`)
        const h = (await res.json()) as { status: string; db: string; version: string }
        if (stopped) return
        usePetStore.getState().setStatus(h.db === 'ok' ? 'online' : 'offline', h.version)
      } catch {
        if (!stopped) usePetStore.getState().setStatus('offline')
      }
    }
    void poll()
    timer = window.setInterval(() => void poll(), 5000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  // 启动即拉一次历史（后端未起也不报错，等恢复后过渡刷新兜底）
  useEffect(() => {
    void useChatStore.getState().refresh()
  }, [])

  // 断线恢复：offline → online 时对齐历史（服务端可能落了半截/新消息）
  const status = usePetStore((s) => s.status)
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current === 'offline' && status === 'online') {
      void useChatStore.getState().refresh()
    }
    prevStatusRef.current = status
  }, [status])

  // 设置窗口清空对话 → 主进程广播 → 同步刷新本地历史
  useEffect(() => window.lovelybuddy.onChatCleared(() => void useChatStore.getState().refresh()), [])

  return (
    <>
      <PetCanvas
        url={modelUrl}
        name={modelName ?? ''}
        menuOpen={menuOpen}
        chatOpen={chatOpen}
        onMenu={() => {
          if (menuOpen) closeMenu()
          else openMenu()
        }}
      />
      {chatOpen && <ChatPanel />}
      <SpeechBubble panelOpen={chatOpen} />
      {modelUrl === null && !placeholderDismissed && (
        <div
          className="placeholder fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-(--sp-2) px-[28px] py-(--sp-5) border border-(--color-border) rounded-card bg-bg text-ink max-w-[420px] shadow-mint"
          data-interactive
        >
          <button
            className="absolute top-(--sp-1) right-2.5 bg-transparent text-ink-3 text-lg leading-none cursor-pointer hover:text-ink"
            title="暂不显示"
            onClick={dismissPlaceholder}
          >
            ×
          </button>
          <p className="text-base font-semibold">未找到 Live2D 模型</p>
          <p className="text-xs leading-[1.6] text-ink-2">支持粘贴 HTTPS zip 链接、选择本地 zip 或目录导入。</p>
          <ImportPanel />
          <div className="flex gap-(--sp-1)">
            <button
              className="px-(--sp-3) py-1.5 rounded-pill bg-primary text-white text-[13px] cursor-pointer"
              onClick={() => void loadModels()}
            >
              重新扫描
            </button>
          </div>
        </div>
      )}
      {menuOpen && (
        <PetMenu
          onClose={closeMenu}
          onChat={() => {
            closeMenu()
            openPanel()
          }}
          onSettings={() => {
            closeMenu()
            void window.lovelybuddy.openSettings()
          }}
        />
      )}
    </>
  )
}

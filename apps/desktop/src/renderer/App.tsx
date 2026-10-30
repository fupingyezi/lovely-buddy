import { useEffect, type ReactElement } from 'react'
import PetCanvas from '@/pet/PetCanvas'
import PetMenu from '@/pet/PetMenu'
import PlaceholderCard from '@/pet/PlaceholderCard'
import ChatPanel from '@/pet/chat/ChatPanel'
import SpeechBubble from '@/pet/chat/SpeechBubble'
import { useChatPanel } from '@/pet/chat/useChatPanel'
import { usePetMenu } from '@/pet/usePetMenu'
import { usePetStore } from '@/store/petStore'
import { useWindowGeometrySync } from '@/live2d/window/windowGeometry'
import { useBackendHealth } from '@/useBackendHealth'
import { useChatSync } from '@/useChatSync'

export default function App(): ReactElement {
  const modelUrl = usePetStore((s) => s.modelUrl)
  const modelName = usePetStore((s) => s.modelName)
  const modelActions = usePetStore((s) => s.modelActions)
  const placeholderDismissed = usePetStore((s) => s.placeholderDismissed)
  const loadModels = usePetStore((s) => s.loadModels)
  const dismissPlaceholder = usePetStore((s) => s.dismissPlaceholder)
  const { menuOpen, openMenu, closeMenu } = usePetMenu()
  const { open: chatOpen, openPanel } = useChatPanel()
  useWindowGeometrySync()

  useBackendHealth()
  useChatSync()

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  // 设置窗口形象变更（选择/导入/删除）→ 主进程广播（带生效 url）→ 刷新列表并应用
  useEffect(
    () => window.lovelybuddy.onModelsChanged((url) => void usePetStore.getState().loadModels(url ?? undefined)),
    []
  )

  return (
    <>
      <PetCanvas
        url={modelUrl}
        name={modelName ?? ''}
        actions={modelActions}
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
        <PlaceholderCard onDismiss={dismissPlaceholder} onRescan={() => void loadModels()} />
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

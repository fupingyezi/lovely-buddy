import { useEffect, type ReactElement } from 'react'
import PetCanvas from './pet/PetCanvas'
import PetMenu from './pet/PetMenu'
import ImportPanel from './pet/ImportPanel'
import { usePetMenu } from './pet/usePetMenu'
import { usePetStore } from './store/petStore'

export default function App(): ReactElement {
  const modelUrl = usePetStore((s) => s.modelUrl)
  const modelName = usePetStore((s) => s.modelName)
  const placeholderDismissed = usePetStore((s) => s.placeholderDismissed)
  const loadModels = usePetStore((s) => s.loadModels)
  const dismissPlaceholder = usePetStore((s) => s.dismissPlaceholder)
  const { menu, openMenu, closeMenu } = usePetMenu()

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

  return (
    <>
      <PetCanvas
        url={modelUrl}
        name={modelName ?? ''}
        menuOpen={menu !== null}
        onMenu={(x, y) => {
          if (menu) closeMenu()
          else void openMenu(x, y)
        }}
      />
      {modelUrl === null && !placeholderDismissed && (
        <div className="placeholder" data-interactive>
          <button className="placeholder-close" title="暂不显示" onClick={dismissPlaceholder}>
            ×
          </button>
          <p className="placeholder-title">未找到 Live2D 模型</p>
          <p className="hint">
            支持粘贴 HTTPS zip 链接、选择本地 zip 或目录导入。洛天依模型需用户自行获取（版权归上海禾念）。
          </p>
          <ImportPanel />
          <div className="placeholder-actions">
            <button onClick={() => void loadModels()}>重新扫描</button>
          </div>
        </div>
      )}
      {menu !== null && <PetMenu x={menu.x} y={menu.y} onClose={closeMenu} />}
    </>
  )
}

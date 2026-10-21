import { useEffect, type ReactElement } from 'react'
import PetCanvas from './pet/PetCanvas'
import { usePetStore } from './store/petStore'

export default function App(): ReactElement {
  const models = usePetStore((s) => s.models)
  const modelUrl = usePetStore((s) => s.modelUrl)
  const modelName = usePetStore((s) => s.modelName)
  const modelError = usePetStore((s) => s.modelError)
  const placeholderDismissed = usePetStore((s) => s.placeholderDismissed)
  const status = usePetStore((s) => s.status)
  const version = usePetStore((s) => s.version)
  const loadModels = usePetStore((s) => s.loadModels)
  const selectModel = usePetStore((s) => s.selectModel)
  const pickModelDir = usePetStore((s) => s.pickModelDir)
  const dismissPlaceholder = usePetStore((s) => s.dismissPlaceholder)

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

  const statusText =
    status === 'online' ? `天依在线 v${version ?? ''}` : status === 'offline' ? '后端离线' : '后端连接中…'

  return (
    <>
      <PetCanvas url={modelUrl} name={modelName ?? ''} />
      {modelUrl === null && !placeholderDismissed && (
        <div className="placeholder" data-interactive>
          <button className="placeholder-close" title="暂不显示" onClick={dismissPlaceholder}>
            ×
          </button>
          <p className="placeholder-title">未找到 Live2D 模型</p>
          <p className="hint">
            请将模型放入 model/ 目录（*.model3.json 或 *.model.json），或直接选择模型所在文件夹。
            洛天依模型需用户自行获取（版权归上海禾念）。
          </p>
          <div className="placeholder-actions">
            <button onClick={() => void pickModelDir()}>选择模型目录</button>
            <button onClick={() => void loadModels()}>重新扫描</button>
          </div>
        </div>
      )}
      <div className="top-right" data-interactive>
        {models.length > 1 && (
          <div className="model-switcher">
            {models.map((m) => (
              <button
                key={m.url}
                className={m.url === modelUrl ? 'active' : ''}
                onClick={() => selectModel(m)}
                title={`${m.name}（${m.kind === 'moc3' ? 'Cubism 4' : 'Cubism 2'}）`}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
        <div className="status-card">
          <span className={`dot ${status === 'online' ? 'ok' : 'bad'}`} />
          <span>{statusText}</span>
        </div>
        {modelError !== null && modelUrl !== null && <div className="model-error">{modelError}</div>}
      </div>
    </>
  )
}

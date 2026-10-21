import { useEffect, useState, type ReactElement } from 'react'
import PetCanvas from './pet/PetCanvas'
import { usePetStore } from './store/petStore'
import type { ImportSource } from './lib/assetsApi'

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
  const dismissPlaceholder = usePetStore((s) => s.dismissPlaceholder)
  const importing = usePetStore((s) => s.importing)
  const importError = usePetStore((s) => s.importError)
  const importModel = usePetStore((s) => s.importModel)
  const deleteModel = usePetStore((s) => s.deleteModel)
  const [importOpen, setImportOpen] = useState(false)
  const [urlText, setUrlText] = useState('')

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

  // 本地导入：弹文件/目录选择框 → 交给后端导入管线
  const importLocal = async (mode: 'zip' | 'dir'): Promise<void> => {
    const picked = await window.lovelybuddy.pickImportPath(mode)
    if (picked.canceled || !picked.path) return
    const source: ImportSource = { type: 'path', value: picked.path }
    if (await importModel(source)) setImportOpen(false)
  }

  const importFromUrl = async (): Promise<void> => {
    const value = urlText.trim()
    if (!value) return
    const source: ImportSource = { type: 'url', value }
    if (await importModel(source)) {
      setUrlText('')
      setImportOpen(false)
    }
  }

  const confirmDelete = (): void => {
    const name = usePetStore.getState().modelName ?? '当前形象'
    if (window.confirm(`删除形象「${name}」？此操作不可恢复。`)) {
      const info = usePetStore.getState().models.find((m) => m.url === usePetStore.getState().modelUrl)
      if (info) void deleteModel(info)
    }
  }

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
            支持粘贴 HTTPS zip 链接、选择本地 zip 或目录导入。洛天依模型需用户自行获取（版权归上海禾念）。
          </p>
          <div className="placeholder-actions">
            <button onClick={() => setImportOpen(true)}>导入形象</button>
            <button onClick={() => void loadModels()}>重新扫描</button>
          </div>
        </div>
      )}
      <div className="top-right" data-interactive>
        {models.length > 1 && (
          <div className="model-switcher">
            {models.map((m) => (
              <button
                key={m.slug}
                className={m.url === modelUrl ? 'active' : ''}
                onClick={() => selectModel(m)}
                title={`${m.name}（${m.kind === 'moc3' ? 'Cubism 4' : 'Cubism 2'}）`}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
        <div className="avatar-actions">
          <button className="btn-plain" onClick={() => setImportOpen(!importOpen)}>
            {importOpen ? '收起' : '导入形象'}
          </button>
          {modelUrl !== null && (
            <button className="btn-plain danger" onClick={confirmDelete}>
              删除当前形象
            </button>
          )}
        </div>
        {importOpen && (
          <div className="import-panel">
            <input
              className="import-url"
              placeholder="粘贴 https://…zip 链接"
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              disabled={importing}
            />
            <div className="import-buttons">
              <button onClick={() => void importFromUrl()} disabled={importing || !urlText.trim()}>
                {importing ? '导入中…' : '从 URL 导入'}
              </button>
              <button onClick={() => void importLocal('zip')} disabled={importing}>
                本地 zip
              </button>
              <button onClick={() => void importLocal('dir')} disabled={importing}>
                本地目录
              </button>
            </div>
            {importing && <p className="import-status">导入中…（大文件可能需要一点时间）</p>}
            {importError !== null && <p className="import-error">{importError}</p>}
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

import { useState, type ReactElement } from 'react'
import { usePetStore } from '../store/petStore'
import ImportPanel from './ImportPanel'

interface Props {
  x: number
  y: number
  onClose: () => void
}

/**
 * 右键点击角色弹出来的小菜单（非常驻）：状态行 + 形象切换 + 导入/删除。
 * 位置由 App 在窗口扩展后夹紧算出。关闭 = 点菜单外 / 再右键 / Esc，由 App 统一处理。
 */
export default function PetMenu({ x, y, onClose }: Props): ReactElement {
  const models = usePetStore((s) => s.models)
  const modelUrl = usePetStore((s) => s.modelUrl)
  const modelName = usePetStore((s) => s.modelName)
  const modelError = usePetStore((s) => s.modelError)
  const status = usePetStore((s) => s.status)
  const version = usePetStore((s) => s.version)
  const selectModel = usePetStore((s) => s.selectModel)
  const deleteModel = usePetStore((s) => s.deleteModel)
  const [importOpen, setImportOpen] = useState(false)

  const statusText =
    status === 'online' ? `天依在线 v${version ?? ''}` : status === 'offline' ? '后端离线' : '后端连接中…'

  const confirmDelete = (): void => {
    if (window.confirm(`删除形象「${modelName ?? '当前形象'}」？此操作不可恢复。`)) {
      const info = usePetStore.getState().models.find((m) => m.url === usePetStore.getState().modelUrl)
      if (info) void deleteModel(info)
    }
  }

  return (
    <div
      className="pet-menu"
      data-interactive
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="menu-close"
        title="关闭菜单"
        aria-label="关闭菜单"
        onClick={onClose}
      >
        ×
      </button>
      <div className="menu-status">
        <span className={`dot ${status === 'online' ? 'ok' : 'bad'}`} />
        <span>{statusText}</span>
      </div>
      {models.length > 1 && (
        <div className="menu-models">
          {models.map((m) => (
            <button
              key={m.slug}
              className={m.url === modelUrl ? 'active' : ''}
              onClick={() => {
                onClose()
                selectModel(m)
              }}
              title={`${m.name}（${m.kind === 'moc3' ? 'Cubism 4' : 'Cubism 2'}）`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      <div className="menu-actions">
        <button onClick={() => setImportOpen(!importOpen)}>{importOpen ? '收起' : '导入形象'}</button>
        {modelUrl !== null && (
          <button className="danger" onClick={confirmDelete}>
            删除当前形象
          </button>
        )}
      </div>
      {importOpen && <ImportPanel onDone={onClose} />}
      {modelError !== null && modelUrl !== null && <div className="model-error">{modelError}</div>}
    </div>
  )
}

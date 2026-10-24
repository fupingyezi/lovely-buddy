import { useState, type ReactElement } from 'react'
import { usePetStore } from '../store/petStore'
import { useWindowGeometry } from '../live2d/windowGeometry'
import { menuTop, MENU_INSET } from './menuLayout'
import ImportPanel from './ImportPanel'

interface Props {
  onClose: () => void
  /** 「聊天」入口（关闭菜单并打开聊天面板，由 App 决定） */
  onChat: () => void
  /** 「设置」入口（关闭菜单并打开设置面板，由 App 决定） */
  onSettings: () => void
}

/**
 * 右键点击角色弹出来的小菜单（非常驻）：状态行 + 形象切换 + 导入/删除 + 聊天入口。
 * 位置响应式：右贴窗口（right=MENU_INSET），底边距头顶 8px（几何 store 实时推导）——
 * 聊天扩展等叠加时窗口左上角远离角色，菜单必须锚角色头顶而不是窗口左上。
 * 关闭 = 点菜单外 / 再右键 / Esc，由 App 统一处理。
 */
export default function PetMenu({ onClose, onChat, onSettings }: Props): ReactElement {
  const models = usePetStore((s) => s.models)
  const modelUrl = usePetStore((s) => s.modelUrl)
  const modelName = usePetStore((s) => s.modelName)
  const modelError = usePetStore((s) => s.modelError)
  const status = usePetStore((s) => s.status)
  const version = usePetStore((s) => s.version)
  const selectModel = usePetStore((s) => s.selectModel)
  const deleteModel = usePetStore((s) => s.deleteModel)
  const [importOpen, setImportOpen] = useState(false)
  const { size, base } = useWindowGeometry()
  const top = base ? menuTop(size.h - base.h) : MENU_INSET

  const statusText =
    status === 'online' ? `AI桌宠在线 v${version ?? ''}` : status === 'offline' ? '后端离线' : '后端连接中…'

  const confirmDelete = (): void => {
    if (window.confirm(`删除形象「${modelName ?? '当前形象'}」？此操作不可恢复。`)) {
      const info = usePetStore.getState().models.find((m) => m.url === usePetStore.getState().modelUrl)
      if (info) void deleteModel(info)
    }
  }

  return (
    <div
      className="pet-menu fixed z-[100] flex flex-col gap-(--sp-1) w-[260px] h-[320px] overflow-y-auto p-(--sp-2) border border-(--color-border) rounded-panel bg-bg text-ink text-xs shadow-mint select-none"
      data-interactive
      style={{ top, right: MENU_INSET }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="absolute top-1.5 right-(--sp-1) bg-transparent text-ink-3 text-base leading-none cursor-pointer hover:text-ink"
        title="关闭菜单"
        aria-label="关闭菜单"
        onClick={onClose}
      >
        ×
      </button>
      <div className="flex items-center gap-(--sp-1) pr-(--sp-5) pb-(--sp-1) border-b border-(--color-border) cursor-default">
        <span className={`size-2 rounded-full ${status === 'online' ? 'bg-primary' : 'bg-accent-ink'}`} />
        <span>{statusText}</span>
      </div>
      {models.length > 1 && (
        <div className="flex flex-col gap-1">
          {models.map((m) => (
            <button
              key={m.slug}
              className={`px-2.5 py-1.5 border rounded-(--sp-1) text-xs text-left cursor-pointer hover:bg-hover-bg hover:text-ink ${
                m.url === modelUrl
                  ? 'active bg-primary text-white border-transparent'
                  : 'bg-transparent border-(--color-border) text-ink-2'
              }`}
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
      <div className="flex gap-1.5">
        <button
          className="flex-1 px-2.5 py-1.5 border border-(--color-border) rounded-(--sp-1) bg-transparent text-ink-2 text-xs text-center cursor-pointer hover:bg-hover-bg hover:text-ink"
          onClick={onChat}
        >
          聊天
        </button>
        <button
          className="flex-1 px-2.5 py-1.5 border border-(--color-border) rounded-(--sp-1) bg-transparent text-ink-2 text-xs text-center cursor-pointer hover:bg-hover-bg hover:text-ink"
          onClick={onSettings}
        >
          设置
        </button>
        <button
          className="flex-1 px-2.5 py-1.5 border border-(--color-border) rounded-(--sp-1) bg-transparent text-ink-2 text-xs text-center cursor-pointer hover:bg-hover-bg hover:text-ink"
          onClick={() => setImportOpen(!importOpen)}
        >
          {importOpen ? '收起' : '导入形象'}
        </button>
        {modelUrl !== null && (
          <button
            className="flex-1 px-2.5 py-1.5 border border-(--color-accent) rounded-(--sp-1) bg-transparent text-accent-ink text-xs text-center cursor-pointer hover:bg-hover-bg hover:text-ink"
            onClick={confirmDelete}
          >
            删除当前形象
          </button>
        )}
      </div>
      {importOpen && <ImportPanel onDone={onClose} />}
      {modelError !== null && modelUrl !== null && (
        <div className="max-w-[320px] px-(--sp-3) py-(--sp-1) border border-(--color-accent) rounded-[10px] bg-stop-bg text-accent-ink text-xs break-all">
          {modelError}
        </div>
      )}
    </div>
  )
}

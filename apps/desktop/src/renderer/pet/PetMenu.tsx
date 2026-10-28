import type { ReactElement } from 'react'
import { usePetStore } from '@/store/petStore'
import { useWindowGeometry } from '@/live2d/window/windowGeometry'
import { listHeight, MAX_LIST_ROWS, MENU_INSET, menuHeight, menuTop } from '@/pet/menuLayout'

interface Props {
  onClose: () => void
  /** 「聊天」入口（关闭菜单并打开聊天面板，由 App 决定） */
  onChat: () => void
  /** 「设置」入口（关闭菜单并打开设置面板，由 App 决定） */
  onSettings: () => void
}

/**
 * 右键点击角色弹出来的小菜单：状态行 + 形象切换（>1 个时）+ 聊天/设置入口。
 * 导入/删除收敛到设置·形象管理；高度自适应 menuHeight(n)，
 * 与 usePetMenu 的扩展量同源（menuLayout 单一事实来源）。
 * 位置响应式：右贴窗口（right=MENU_INSET），底边距头顶 8px（几何 store 实时推导）——
 * 聊天扩展等叠加时窗口左上角远离角色，菜单必须锚角色头顶而不是窗口左上。
 * 关闭 = 点菜单外 / 再右键 / Esc，由 App 统一处理。
 */
export default function PetMenu({ onClose, onChat, onSettings }: Props): ReactElement {
  const models = usePetStore((s) => s.models)
  const modelUrl = usePetStore((s) => s.modelUrl)
  const status = usePetStore((s) => s.status)
  const version = usePetStore((s) => s.version)
  const selectModel = usePetStore((s) => s.selectModel)
  const { size, base } = useWindowGeometry()
  const top = base ? menuTop(size.h - base.h, models.length) : MENU_INSET

  const online = status === 'online'
  const statusText = online ? `AI桌宠在线 v${version ?? ''}` : status === 'offline' ? '后端离线' : '后端连接中…'

  return (
    <div
      className="pet-menu fixed z-[100] flex flex-col gap-2 w-[260px] p-2.5 border border-border-warm rounded-[18px] bg-bg text-ink text-xs shadow-menu select-none"
      data-interactive
      style={{ top, right: MENU_INSET, height: menuHeight(models.length) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex h-4 items-center gap-1 pr-6 cursor-default">
        <span className={`size-1.5 shrink-0 rounded-full ${online ? 'bg-[#4cc29a]' : 'bg-[#f08fa4]'}`} />
        <span className="truncate text-[10px] font-medium text-ink-soft">{statusText}</span>
      </div>
      <div className="h-px bg-[#e5dbcc]" />
      {models.length > 1 && (
        <>
          <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: listHeight(MAX_LIST_ROWS) }}>
            {models.map((m) => {
              const active = m.url === modelUrl
              return (
                <button
                  key={m.slug}
                  className={`flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-2 text-left cursor-pointer ${
                    active
                      ? 'active bg-selected-bg font-semibold text-active-ink'
                      : 'bg-transparent text-ink hover:bg-bg'
                  }`}
                  onClick={() => {
                    onClose()
                    selectModel(m)
                  }}
                  title={`${m.name}（${m.kind === 'moc3' ? 'Cubism 4' : 'Cubism 2'}）`}
                >
                  <Thumb m={m} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {active && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 7.5L5.5 10.5L11.5 3.5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
          <div className="h-px bg-[#e5dbcc]" />
        </>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={`flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[11px] font-medium ${
            online
              ? 'bg-linear-to-r from-primary to-deep-end text-white cursor-pointer hover:-translate-y-px active:scale-[0.96]'
              : 'bg-[#f5f2ee] text-ink-3 cursor-default'
          }`}
          disabled={!online}
          onClick={onChat}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1.5 2.5h9v5H4L1.5 10V2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          聊天
        </button>
        <button
          type="button"
          className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-cream-deep text-[11px] font-medium text-ink-soft cursor-pointer hover:-translate-y-px active:scale-[0.96]"
          onClick={onSettings}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M6 1.5l1.1 2.2 2.4.4-1.7 1.7.4 2.4L6 7.2 3.8 8.2l.4-2.4L2.5 4.1l2.4-.4L6 1.5Z"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
          </svg>
          设置
        </button>
      </div>
      <button
        type="button"
        className="absolute top-2.5 right-2 bg-transparent text-[#c4bdb4] text-xs leading-none cursor-pointer hover:text-ink-soft"
        title="关闭菜单"
        aria-label="关闭菜单"
        onClick={onClose}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

/** 24×24 形象缩略：有自带预览图用 <img>（l2d:// 协议），否则占位小白人轮廓 */
function Thumb({ m }: { m: AvatarInfo }): ReactElement {
  if (m.thumbUrl) {
    return (
      <img src={m.thumbUrl} alt="" draggable={false} className="size-6 shrink-0 rounded-md object-cover bg-[#eaf7f1]" />
    )
  }
  return (
    <div className="size-6 shrink-0 rounded-md bg-[#eaf7f1] flex items-center justify-center">
      <svg viewBox="0 0 48 48" className="size-3.5" fill="none" aria-hidden="true">
        <circle cx="24" cy="27" r="10" fill="#fff" />
        <circle cx="24" cy="13" r="5.5" fill="#fff" />
        <circle cx="21.5" cy="13.5" r="1" fill="#33403b" />
        <circle cx="26.5" cy="13.5" r="1" fill="#33403b" />
        <path d="M19.5 29.5c3 2 6 2 9 0" stroke="#33403b" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

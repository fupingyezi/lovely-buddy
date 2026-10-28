import { useState, type ReactElement } from 'react'
import AboutPage from '@/settings/AboutPage'
import CharacterPage from '@/settings/CharacterPage'
import ChatHistoryPage from '@/settings/ChatHistoryPage'
import ConnectionPage from '@/settings/ConnectionPage'
import ModelPage from '@/settings/ModelPage'
import { IconChat, IconInfo, IconLink, IconModel, IconPersona } from '@/settings/icons'

type PageId = 'chat' | 'model' | 'connection' | 'character' | 'about'

interface NavItem {
  name: string
  page: PageId
  icon: ReactElement
}

const NAV_ITEMS: NavItem[] = [
  { name: '形象管理', page: 'model', icon: <IconModel /> },
  { name: '模型与连接', page: 'connection', icon: <IconLink /> },
  { name: '对话记录', page: 'chat', icon: <IconChat /> },
  { name: '角色设定', page: 'character', icon: <IconPersona /> },
  { name: '关于', page: 'about', icon: <IconInfo /> }
]

/**
 * 设置面板壳（独立无边框窗口内的主区）：184 侧栏五入口（形象管理/模型与连接/对话记录/
 * 角色设定/关于，全部可用）+ 内容区按页切换。
 * 窗口关闭走标题条关闭按钮 / Esc（SettingsApp），面板本身不含关闭钮。
 */
export default function SettingsPanel(): ReactElement {
  const [page, setPage] = useState<PageId>('chat')

  return (
    <div
      className="settings-panel flex-1 min-h-0 flex bg-surface overflow-hidden select-none"
      data-interactive
      onContextMenu={(e) => e.preventDefault()}
    >
      <aside className="shrink-0 w-[184px] flex flex-col p-4 bg-cream-deep">
        <div className="flex flex-col gap-1 mb-6">
          <span className="text-[13px] font-bold text-primary-deep">lovely-buddy</span>
          <span className="text-[10px] text-ink-3">本地 AI 桌宠 · v0.1</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.page === page
            return (
              <button
                key={item.name}
                type="button"
                className={`flex h-[34px] items-center gap-2 rounded-[10px] px-2 text-xs text-left cursor-pointer transition-[transform,background] duration-[120ms] ease-standard hover:bg-hover-bg active:scale-[0.96] ${
                  active ? 'active bg-selected-bg font-semibold text-active-ink' : 'bg-transparent text-ink-soft'
                }`}
                onClick={() => setPage(item.page)}
              >
                {item.icon}
                {item.name}
              </button>
            )
          })}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col gap-(--sp-3) p-5">
        {page === 'chat' ? (
          <ChatHistoryPage />
        ) : page === 'model' ? (
          <ModelPage />
        ) : page === 'connection' ? (
          <ConnectionPage />
        ) : page === 'character' ? (
          <CharacterPage />
        ) : (
          <AboutPage />
        )}
      </main>
    </div>
  )
}

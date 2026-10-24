import { useState, type ReactElement } from 'react'
import ChatHistoryPage from './ChatHistoryPage'
import ConnectionPage from './ConnectionPage'
import ModelPage from './ModelPage'

type PageId = 'chat' | 'model' | 'connection'

interface NavItem {
  name: string
  page: PageId | null
  icon: ReactElement
}

const NAV_ITEMS: NavItem[] = [
  {
    name: '形象管理',
    page: 'model',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="9.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="6.9" cy="5" r="0.5" fill="currentColor" />
        <circle cx="9.1" cy="5" r="0.5" fill="currentColor" />
        <path d="M5.8 10.2c1.4 1 3 1 4.4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  },
  {
    name: '模型与连接',
    page: 'connection',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M4.5 11.5l-1 1a2.12 2.12 0 010-3l2-2a2.12 2.12 0 013 0l1 1M11.5 4.5l1-1a2.12 2.12 0 010 3l-2 2a2.12 2.12 0 01-3 0l-1-1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    )
  },
  {
    name: '对话记录',
    page: 'chat',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 3.5h11v6.5H6L3 13V3.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    name: '外观与动作',
    page: null,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1.5l1.3 3.4 3.4 1.3-3.4 1.3L8 11l-1.3-3.5-3.4-1.3 3.4-1.3L8 1.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path d="M12.5 10.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z" fill="currentColor" />
      </svg>
    )
  },
  {
    name: '关于',
    page: null,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="5" r="0.6" fill="currentColor" />
      </svg>
    )
  }
]

/**
 * 设置面板壳（独立无边框窗口内的主区）：184 侧栏五入口（本期「形象管理/模型与连接/对话记录」
 * 可用，外观与动作/关于 M3+ 占位禁用）+ 内容区按页切换。
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
            const active = item.page !== null && item.page === page
            return (
              <button
                key={item.name}
                type="button"
                className={`flex h-[34px] items-center gap-2 rounded-[10px] px-2 text-xs text-left cursor-pointer transition-[transform,background] duration-[120ms] ease-standard enabled:hover:bg-hover-bg enabled:active:scale-[0.96] disabled:cursor-default ${
                  active
                    ? 'active bg-selected-bg font-semibold text-active-ink'
                    : item.page !== null
                      ? 'bg-transparent text-ink-soft'
                      : 'bg-transparent text-ink-3'
                }`}
                disabled={item.page === null}
                onClick={() => item.page !== null && setPage(item.page)}
              >
                {item.icon}
                {item.name}
              </button>
            )
          })}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col gap-(--sp-3) p-5">
        {page === 'chat' ? <ChatHistoryPage /> : page === 'model' ? <ModelPage /> : <ConnectionPage />}
      </main>
    </div>
  )
}

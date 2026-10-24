import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '../../store/chatStore'
import { exportFileName, filterChatItems, groupByDay, historyToMarkdown, sessionSubtitle } from './historyExport'

const NAV = ['形象管理', '模型与连接', '对话记录', '外观与动作', '关于'] as const

/**
 * 设置面板（覆盖整窗，图 03）：侧栏五入口（本期只有「对话记录」可用，其余 M3 实现）
 * + 对话记录页（搜索/会话卡/消息流/导出/清空）。data-interactive 保证穿透状态机可点。
 * 无关闭钮（图 03），关闭走 Esc / 点面板外（useSettingsPanel）。
 */
export default function SettingsPanel(): ReactElement {
  const items = useChatStore((s) => s.items)
  const clear = useChatStore((s) => s.clear)
  const [query, setQuery] = useState('')
  const [exported, setExported] = useState(false)
  const exportedTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (exportedTimer.current !== null) window.clearTimeout(exportedTimer.current)
    }
  }, [])

  const groups = groupByDay(filterChatItems(items, query))

  const doClear = (): void => {
    if (window.confirm('清空全部对话记录？此操作不可恢复。')) void clear()
  }

  const doExport = async (): Promise<void> => {
    const { saved } = await window.lovelybuddy.exportFile(exportFileName(new Date()), historyToMarkdown(items))
    if (saved) {
      setExported(true)
      exportedTimer.current = window.setTimeout(() => setExported(false), 2000)
    }
  }

  return (
    <div className="settings-panel" data-interactive onContextMenu={(e) => e.preventDefault()}>
      <aside className="settings-side">
        <div className="settings-brand">
          <span className="settings-brand-name">lovely-buddy</span>
          <span className="settings-brand-ver">本地 AI桌宠•v0.1</span>
        </div>
        <nav className="settings-nav">
          {NAV.map((name) => (
            <button
              key={name}
              type="button"
              className={`settings-nav-item${name === '对话记录' ? ' active' : ''}`}
              disabled={name !== '对话记录'}
            >
              {name}
            </button>
          ))}
        </nav>
      </aside>
      <main className="settings-main">
        <header className="settings-toolbar">
          <input
            className="settings-search"
            placeholder="搜索记录"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="settings-export" onClick={() => void doExport()}>
            {exported ? '已导出' : '导出'}
          </button>
          <button type="button" className="settings-clear" onClick={doClear}>
            清空
          </button>
        </header>
        <div className="settings-body">
          <section className="settings-convs">
            <button type="button" className="conv-card active">
              <span className="conv-title">AI桌宠对话</span>
              <span className="conv-sub">{sessionSubtitle(items)}</span>
            </button>
          </section>
          <section className="settings-flow">
            {groups.length === 0 && <p className="settings-empty">暂无对话记录</p>}
            {groups.map((g) => (
              <div key={g.label} className="flow-group">
                <div className="flow-date">{g.label}</div>
                {g.items.map((it, i) => (
                  <div key={i} className={`flow-msg ${it.role}`}>
                    {it.content}
                  </div>
                ))}
              </div>
            ))}
          </section>
        </div>
        <footer className="settings-footer">仅保留最近 200 条•可导出为 Markdown</footer>
      </main>
    </div>
  )
}

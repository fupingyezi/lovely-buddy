import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '../../store/chatStore'
import { exportFileName, filterChatItems, groupByDay, historyToMarkdown, sessionSubtitle } from './historyExport'

const NAV = ['形象管理', '模型与连接', '对话记录', '外观与动作', '关于'] as const

/**
 * 设置面板内容（独立无边框窗口内的主区，图 03）：侧栏五入口（本期只有「对话记录」可用，
 * 其余 M3 实现）+ 对话记录页（搜索/会话卡/消息流/导出/清空）。
 * 窗口关闭走标题条关闭按钮 / Esc（SettingsApp），面板本身不含关闭钮（图 03）。
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

  const doClear = async (): Promise<void> => {
    if (!window.confirm('清空全部对话记录？此操作不可恢复。')) return
    await clear()
    // clear 失败写 error 字段；仅成功后通知主进程广播，桌宠窗口同步刷新
    if (useChatStore.getState().error === null) window.lovelybuddy.notifyChatCleared()
  }

  const doExport = async (): Promise<void> => {
    const { saved } = await window.lovelybuddy.exportFile(exportFileName(new Date()), historyToMarkdown(items))
    if (saved) {
      setExported(true)
      exportedTimer.current = window.setTimeout(() => setExported(false), 2000)
    }
  }

  return (
    <div
      className="settings-panel flex-1 min-h-0 flex bg-surface overflow-hidden select-none"
      data-interactive
      onContextMenu={(e) => e.preventDefault()}
    >
      <aside className="shrink-0 w-[240px] flex flex-col py-(--sp-5) px-(--sp-2) bg-bg">
        <div className="flex flex-col gap-1 mb-(--sp-5)">
          <span className="text-primary-deep text-(--fs-title) font-semibold">lovely-buddy</span>
          <span className="text-ink-2 text-(--fs-aux)">本地 AI桌宠•v0.1</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((name) => (
            <button
              key={name}
              type="button"
              className={`rounded-(--sp-3) px-(--sp-2) py-2.5 text-(--fs-body) text-left cursor-pointer transition-[transform,background] duration-[120ms] ease-standard enabled:hover:bg-hover-bg enabled:active:scale-[0.96] disabled:text-ink-3 disabled:cursor-default ${
                name === '对话记录' ? 'active bg-selected-bg text-primary-deep' : 'bg-transparent text-ink'
              }`}
              disabled={name !== '对话记录'}
            >
              {name}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col px-(--sp-4) py-4">
        <header className="shrink-0 flex items-center gap-(--sp-1) mb-(--sp-2)">
          <input
            className="flex-1 min-w-0 border border-(--color-border) rounded-pill bg-surface px-(--sp-3) py-(--sp-1) text-ink text-(--fs-body) outline-none placeholder:text-ink-3 focus:border-primary focus:shadow-focus"
            placeholder="搜索记录"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="shrink-0 rounded-pill bg-transparent px-(--sp-3) py-(--sp-1) text-ink-2 text-(--fs-body) cursor-pointer hover:text-ink"
            onClick={() => void doExport()}
          >
            {exported ? '已导出' : '导出'}
          </button>
          <button
            type="button"
            className="shrink-0 rounded-pill bg-bg px-(--sp-3) py-(--sp-1) text-accent-ink text-(--fs-body) cursor-pointer hover:-translate-y-px active:scale-[0.96]"
            onClick={doClear}
          >
            清空
          </button>
        </header>
        <div className="flex-1 min-h-0 flex gap-(--sp-2)">
          <section className="shrink-0 w-[280px] overflow-y-auto flex flex-col gap-(--sp-2)">
            <button
              type="button"
              className="conv-card active shrink-0 flex flex-col gap-1.5 rounded-(--sp-3) bg-selected-bg px-(--sp-3) py-(--sp-2) text-left cursor-pointer"
            >
              <span className="text-primary-deep text-(--fs-body) font-semibold">AI桌宠对话</span>
              <span className="text-ink-2 text-(--fs-aux)">{sessionSubtitle(items)}</span>
            </button>
          </section>
          <section className="flex-1 min-w-0 overflow-y-auto flex flex-col gap-(--sp-2) select-text">
            {groups.length === 0 && <p className="text-ink-3 text-center mt-[60px]">暂无对话记录</p>}
            {groups.map((g) => (
              <div key={g.label} className="flex flex-col gap-(--sp-1)">
                <div className="self-center text-ink-3 text-(--fs-aux)">{g.label}</div>
                {g.items.map((it, i) => (
                  <div
                    key={i}
                    className={`flow-msg max-w-[78%] px-(--sp-3) py-2.5 rounded-msg text-(--fs-body) leading-[1.6] whitespace-pre-wrap break-words ${
                      it.role === 'assistant' ? 'assistant self-start bg-bg text-ink' : 'user self-end bg-primary text-white'
                    }`}
                  >
                    {it.content}
                  </div>
                ))}
              </div>
            ))}
          </section>
        </div>
        <footer className="shrink-0 mt-(--sp-2) text-ink-3 text-(--fs-aux)">仅保留最近 200 条•可导出为 Markdown</footer>
      </main>
    </div>
  )
}

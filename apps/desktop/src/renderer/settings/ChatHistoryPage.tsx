import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '@/store/chatStore'
import {
  exportFileName,
  filterChatItems,
  groupByDay,
  historyToMarkdown,
  sessionSubtitle
} from '@/settings/historyExport'

/**
 * 设置·对话记录页：页头（标题+meta+搜索/导出/清空）+ 会话卡 + 消息流 + 页脚。
 * 历史只读：导出走 exportFile IPC（成功短暂变「已导出」）；清空二次确认后通知主进程
 * 广播（跨窗同步）。会话卡标题取首条消息（无记录回退产品名）。
 */
export default function ChatHistoryPage(): ReactElement {
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
  const title = items.length > 0 ? items[0].content : 'AI桌宠对话'

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
    <>
      <header className="shrink-0 flex items-end justify-between">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[17px] leading-none font-semibold text-ink">对话记录</h1>
          <p className="text-[11px] text-ink-3">共 {items.length} 条 · 仅存于本机</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex h-[30px] w-[136px] items-center gap-1 rounded-pill bg-cream-deep px-2.5">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="text-ink-faint">
              <circle cx="5.2" cy="5.2" r="3.4" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7.8 7.8L10.5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-faint"
              placeholder="搜索记录"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="shrink-0 h-[30px] w-[52px] rounded-pill border border-(--color-border) bg-transparent text-[11px] font-medium text-ink-soft cursor-pointer hover:text-ink"
            onClick={() => void doExport()}
          >
            {exported ? '已导出' : '导出'}
          </button>
          <button
            type="button"
            className="shrink-0 h-[30px] w-[52px] rounded-pill bg-accent-bg text-[11px] font-medium text-accent-ink cursor-pointer hover:-translate-y-px active:scale-[0.96]"
            onClick={() => void doClear()}
          >
            清空
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex gap-2">
        <section className="shrink-0 w-[176px] overflow-y-auto flex flex-col gap-2">
          <div className="conv-card active shrink-0 flex flex-col gap-1.5 rounded-xl bg-selected-bg p-2.5 cursor-default">
            <span className="line-clamp-1 text-xs font-semibold text-active-ink">{title}</span>
            <span className="text-[10px] text-meta-mint">{sessionSubtitle(items)}</span>
          </div>
        </section>
        <section className="flex-1 min-w-0 overflow-y-auto flex flex-col gap-2 select-text">
          {groups.length === 0 && <p className="text-ink-3 text-center mt-[60px]">暂无对话记录</p>}
          {groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-1">
              <div className="self-center text-[10px] text-ink-faint">{g.label}</div>
              {g.items.map((it, i) => (
                <div
                  key={i}
                  className={`flow-msg max-w-[78%] p-2.5 text-(--fs-body) leading-[1.6] whitespace-pre-wrap break-words ${
                    it.role === 'assistant'
                      ? 'assistant self-start bg-cream-deep text-ink rounded-[4px_14px_14px_14px]'
                      : 'user self-end bg-selected-bg text-ink rounded-[14px_4px_14px_14px]'
                  }`}
                >
                  {it.content}
                </div>
              ))}
            </div>
          ))}
        </section>
      </div>
      <footer className="shrink-0 text-[10px] text-ink-footer">仅保留最近 200 条 · 可导出为 Markdown</footer>
    </>
  )
}

import { useEffect, useRef, type ReactElement } from 'react'
import { usePersonaStore } from '@/store/personaStore'
import { useMemoryStore, MEMORY_TYPES } from '@/store/memoryStore'
import type { MemoryItem } from '@/lib/memoryApi'

const VAR_CHIPS = ['{user_name}', '{time}', '{model}'] as const
const MAX_LEN = 2000

/** 「2026-10-27T…」→ 本地时区「10-27」（按 UTC 切片会让 UTC+ 用户凌晨看到前一天） */
function memDate(iso: string): string {
  const d = new Date(iso)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

/** 行 meta：来源（手动添加/自动提取）+ 日期 */
function memMeta(m: MemoryItem): string {
  return `${m.source === 'auto' ? '自动提取' : '手动添加'} · ${memDate(m.created_at)}`
}

/**
 * 设置·角色设定页：页头（标题+meta+保存钮）+ 人设卡 + 记忆卡 + 页脚。
 * 开关语义：开=覆盖内置人设，关=追加在末尾（服务端组合）；空文案不参与。
 * 变量 chips 插入光标处；保存钮只在有未保存改动时可用。
 */
export default function CharacterPage(): ReactElement {
  const text = usePersonaStore((s) => s.text)
  const enabled = usePersonaStore((s) => s.enabled)
  const savedText = usePersonaStore((s) => s.savedText)
  const savedEnabled = usePersonaStore((s) => s.savedEnabled)
  const loading = usePersonaStore((s) => s.loading)
  const saving = usePersonaStore((s) => s.saving)
  const personaError = usePersonaStore((s) => s.error)
  const load = usePersonaStore((s) => s.load)
  const setText = usePersonaStore((s) => s.setText)
  const setEnabled = usePersonaStore((s) => s.setEnabled)
  const save = usePersonaStore((s) => s.save)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const memories = useMemoryStore((s) => s.memories)
  const total = useMemoryStore((s) => s.total)
  const q = useMemoryStore((s) => s.q)
  const memLoading = useMemoryStore((s) => s.loading)
  const adding = useMemoryStore((s) => s.adding)
  const composerOpen = useMemoryStore((s) => s.composerOpen)
  const addType = useMemoryStore((s) => s.addType)
  const addText = useMemoryStore((s) => s.addText)
  const memError = useMemoryStore((s) => s.error)
  const loadMemories = useMemoryStore((s) => s.load)
  const setQ = useMemoryStore((s) => s.setQ)
  const openComposer = useMemoryStore((s) => s.openComposer)
  const closeComposer = useMemoryStore((s) => s.closeComposer)
  const setAddType = useMemoryStore((s) => s.setAddType)
  const setAddText = useMemoryStore((s) => s.setAddText)
  const addMemoryRow = useMemoryStore((s) => s.add)
  const removeMemory = useMemoryStore((s) => s.remove)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadMemories()
  }, [loadMemories])

  const dirty = text !== savedText || enabled !== savedEnabled
  const injected = enabled && text.trim() !== ''

  const insertVar = (v: string): void => {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart ?? text.length
    const end = ta.selectionEnd ?? text.length
    const next = (text.slice(0, start) + v + text.slice(end)).slice(0, MAX_LEN)
    setText(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = Math.min(start + v.length, next.length)
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <>
      <header className="shrink-0 flex items-end justify-between">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[17px] leading-none font-semibold text-ink">角色设定</h1>
          <p className="text-[11px] text-ink-3">提示词注入 · 长期记忆 · 仅本机</p>
        </div>
        <button
          type="button"
          className={`flex h-8 items-center gap-1.5 rounded-pill px-(--sp-3) text-xs font-medium text-white shadow-button ${
            dirty && !saving
              ? 'bg-linear-to-r from-primary to-deep-end cursor-pointer hover:-translate-y-px active:scale-[0.96]'
              : 'bg-[#c9d9d3] cursor-default'
          }`}
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          保存
        </button>
      </header>
      <section className="shrink-0 rounded-[14px] border border-[#f0ebe0] bg-surface flex flex-col">
        <div className="flex h-11 items-center justify-between px-(--sp-3)">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink">角色提示词</span>
            {injected && (
              <span className="h-5 flex items-center rounded-pill bg-selected-bg px-2 text-[10px] font-medium text-primary-deep">
                已注入
              </span>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            className="relative w-7 h-4 rounded-pill cursor-pointer transition-colors duration-[120ms] ease-standard"
            style={{ backgroundColor: enabled ? '#35A483' : '#e3e8e5' }}
            onClick={() => setEnabled(!enabled)}
          >
            <span
              className="absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition-transform duration-[120ms] ease-standard"
              style={{ transform: enabled ? 'translateX(12px)' : 'none' }}
            />
          </button>
        </div>
        <div className="px-(--sp-3) flex flex-col gap-2">
          <textarea
            ref={taRef}
            value={text}
            placeholder="写下它该有的样子，例如性格、说话习惯、偏好……"
            maxLength={MAX_LEN}
            onChange={(e) => setText(e.target.value)}
            className="h-[100px] resize-none rounded-[10px] border border-[#f0ebe0] bg-bg px-2.5 py-2 text-xs leading-relaxed text-ink placeholder:text-ink-3 outline-none focus:border-[#d1ede3]"
          />
          <div className="flex items-center gap-1.5">
            {VAR_CHIPS.map((v) => (
              <button
                key={v}
                type="button"
                className="h-5 flex items-center rounded-pill bg-[#f5faf7] px-2 text-[10px] font-medium text-[#5d7a72] cursor-pointer hover:bg-selected-bg"
                onClick={() => insertVar(v)}
              >
                {v}
              </button>
            ))}
            <span className="text-[10px] text-ink-3">点击插入</span>
          </div>
          <p className="text-[10px] text-ink-3">覆盖内置人设 · 关闭时在末尾追加</p>
        </div>
        <div className="flex h-8 items-center justify-between px-(--sp-3) border-t border-[#f5efe6]">
          <span className="text-[10px] text-ink-3">{personaError ?? (loading ? '读取中…' : '')}</span>
          <span className="text-[10px] text-ink-3">
            {text.length} / {MAX_LEN}
          </span>
        </div>
      </section>
      <section className="flex-1 min-h-0 flex flex-col rounded-[14px] border border-[#f0ebe0] bg-surface">
        <div className="flex h-11 shrink-0 items-center justify-between px-(--sp-3)">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink">长期记忆</span>
            <span className="text-[10px] text-ink-3">{total} / 200</span>
          </div>
          <button
            type="button"
            className="h-6 flex items-center gap-1 rounded-pill bg-[#f5faf7] px-2.5 text-[10px] font-medium text-[#5d7a72] cursor-pointer hover:bg-selected-bg"
            onClick={openComposer}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            新增
          </button>
        </div>
        <div className="shrink-0 px-(--sp-3) pb-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索记忆内容或标签"
            className="h-8 w-full rounded-[10px] border border-[#f0ebe0] bg-bg px-2.5 text-[11px] text-ink placeholder:text-ink-3 outline-none focus:border-[#d1ede3]"
          />
        </div>
        {composerOpen && (
          <div className="shrink-0 mx-(--sp-3) mb-2 rounded-[10px] border border-[#d1ede3] bg-bg p-2 flex flex-col gap-2">
            <div className="flex items-center gap-1">
              {MEMORY_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`h-5 flex items-center rounded-pill px-2 text-[10px] font-medium cursor-pointer ${
                    addType === t
                      ? 'bg-selected-bg text-primary-deep'
                      : 'bg-[#f5faf7] text-[#5d7a72] hover:bg-selected-bg'
                  }`}
                  onClick={() => setAddType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              maxLength={300}
              placeholder="写下一条关于用户的记忆"
              className="h-14 resize-none rounded-[8px] border border-[#f0ebe0] bg-surface px-2 py-1.5 text-[11px] leading-relaxed text-ink placeholder:text-ink-3 outline-none focus:border-[#d1ede3]"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                className="h-6 flex items-center rounded-pill px-2.5 text-[10px] font-medium text-ink-3 cursor-pointer hover:bg-hover-bg"
                onClick={closeComposer}
              >
                取消
              </button>
              <button
                type="button"
                className={`h-6 flex items-center rounded-pill px-2.5 text-[10px] font-medium ${
                  addText.trim() === '' || adding
                    ? 'bg-[#c9d9d3] text-white cursor-default'
                    : 'bg-linear-to-r from-primary to-deep-end text-white cursor-pointer hover:-translate-y-px'
                }`}
                disabled={addText.trim() === '' || adding}
                onClick={() => void addMemoryRow()}
              >
                添加
              </button>
            </div>
          </div>
        )}
        {memError && <p className="shrink-0 px-(--sp-3) pb-1 text-[10px] text-[#c98a94]">{memError}</p>}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 px-(--sp-3) pb-2">
          {memories.length === 0 && !memLoading && (
            <p className="text-ink-3 text-[11px] text-center mt-6">还没有记忆，点「新增」写一条吧</p>
          )}
          {memories.map((m) => (
            <div key={m.id} className="group flex shrink-0 items-start gap-2 rounded-[10px] px-2 py-1.5 hover:bg-bg">
              <span className="mt-0.5 h-5 shrink-0 flex items-center rounded-pill bg-selected-bg px-2 text-[10px] font-medium text-primary-deep">
                {m.type}
              </span>
              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                <span className="text-[11px] leading-relaxed text-ink break-words">{m.content}</span>
                <span className="text-[10px] text-ink-3">{memMeta(m)}</span>
              </div>
              <button
                type="button"
                className="size-6 shrink-0 invisible group-hover:visible flex items-center justify-center rounded-pill text-ink-3 cursor-pointer hover:bg-hover-bg hover:text-ink"
                title="删除记忆"
                aria-label={`删除记忆 ${m.content}`}
                onClick={() => void removeMemory(m.id)}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path
                    d="M1.5 3h8M4 3V1.5h3V3M2.5 3l.5 5.8c0 .4.3.7.7.7h3.6c.4 0 .7-.3.7-.7L8.5 3M4.5 4.8v2.4M6.5 4.8v2.4"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </section>
      <footer className="shrink-0 text-[10px] text-ink-footer">仅存于本机 · 删除后不可恢复</footer>
    </>
  )
}

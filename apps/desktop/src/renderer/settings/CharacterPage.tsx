import { useEffect, useRef, type ReactElement } from 'react'
import { usePersonaStore } from '@/store/personaStore'

const VAR_CHIPS = ['{user_name}', '{time}', '{model}'] as const
const MAX_LEN = 2000

/**
 * 设置·角色设定页：页头（标题+meta+保存钮）+ 人设卡 + 页脚（记忆卡随后同页接入）。
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

  useEffect(() => {
    void load()
  }, [load])

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
      <footer className="shrink-0 text-[10px] text-ink-footer">仅存于本机数据库 · 删除后不可恢复</footer>
    </>
  )
}

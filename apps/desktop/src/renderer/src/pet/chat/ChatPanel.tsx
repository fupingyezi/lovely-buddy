import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { useChatStore } from '../../store/chatStore'
import { usePetStore } from '../../store/petStore'

/**
 * 对话输入条（窗口 chat 扩展区顶部）：单行输入 + 发送/停止 + 错误重试行。
 * 只留输入，历史统一进设置（README 铁律）；与气泡同锚点互斥（App 控制）。
 * data-interactive 保证穿透状态机可点。无关闭钮（图 02），关闭走 Esc / 点面板外（useChatPanel）。
 */
export default function ChatPanel(): ReactElement {
  const sending = useChatStore((s) => s.sending)
  const error = useChatStore((s) => s.error)
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const retry = useChatStore((s) => s.retry)
  const [value, setValue] = useState('')

  const currentSlug = (): string | undefined => {
    const { models, modelUrl } = usePetStore.getState()
    return models.find((m) => m.url === modelUrl)?.slug
  }

  const submit = (): void => {
    const v = value.trim()
    if (!v || sending) return
    setValue('')
    void send(v, currentSlug())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
  }

  const typing = !sending && value !== ''
  return (
    <div
      className="fixed z-[90] top-(--sp-1) left-(--sp-1) right-(--sp-1) flex flex-col gap-(--sp-1) select-none"
      data-interactive
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={`flex items-center gap-(--sp-1) h-16 pl-4 pr-2.5 rounded-input bg-surface shadow-mint transition-[border-color,box-shadow] duration-[150ms] ease-standard focus-within:border-[1.5px] focus-within:border-primary focus-within:shadow-focus ${
          typing ? 'border border-primary-soft' : 'border border-(--color-border) border-x-transparent'
        }`}
      >
        <input
          className="flex-1 min-w-0 bg-transparent text-ink text-(--fs-body) outline-none placeholder:text-ink-3 disabled:text-ink-2"
          autoFocus
          maxLength={4000}
          disabled={sending}
          placeholder={sending ? '回复中…' : '和我说点什么…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {typing && <span className="shrink-0 text-ink-3 text-(--fs-aux)">{value.length}/4000 个字</span>}
        {sending ? (
          <button
            type="button"
            className="shrink-0 px-5 py-(--sp-1) border border-(--color-accent) rounded-pill bg-stop-bg text-accent-ink text-(--fs-body) cursor-pointer transition-[transform,filter,box-shadow,background] duration-[120ms] ease-standard hover:-translate-y-px active:scale-[0.96]"
            onClick={stop}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            className="shrink-0 px-5 py-(--sp-1) rounded-pill bg-primary text-white text-(--fs-body) cursor-pointer transition-[transform,filter,box-shadow,background] duration-[120ms] ease-standard enabled:hover:-translate-y-px enabled:hover:shadow-mint-deep enabled:active:scale-[0.96] enabled:active:bg-primary-press disabled:saturate-[0.6] disabled:cursor-default"
            disabled={!typing}
            onClick={submit}
          >
            发送
          </button>
        )}
      </div>
      {error !== null && (
        <button
          type="button"
          className="self-start px-1 bg-transparent text-accent-ink text-(--fs-aux) text-left cursor-pointer"
          onClick={retry}
        >
          {error}·点击重试
        </button>
      )}
    </div>
  )
}

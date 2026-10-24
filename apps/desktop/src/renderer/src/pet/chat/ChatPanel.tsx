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
        className={`flex items-center gap-2 h-16 p-3 rounded-input bg-surface shadow-input transition-[border-color,box-shadow] duration-[150ms] ease-standard focus-within:border-[1.5px] focus-within:border-primary focus-within:shadow-focus ${
          typing ? 'border border-primary-soft' : 'border border-(--color-border) border-x-transparent'
        }`}
      >
        <input
          className="flex-1 min-w-0 bg-transparent text-ink text-[14px] outline-none placeholder:text-ink-3 disabled:text-ink-2"
          autoFocus
          maxLength={4000}
          disabled={sending}
          placeholder={sending ? '回复中…' : '和我说点什么…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {typing && <span className="shrink-0 text-ink-3 text-[10px]">{value.length}/4000</span>}
        {sending ? (
          <button
            type="button"
            className="shrink-0 h-10 w-[78px] rounded-pill border border-[#ef8fa8] bg-stop-bg text-accent-ink text-xs font-medium cursor-pointer transition-[transform,filter] duration-[120ms] ease-standard hover:-translate-y-px active:scale-[0.96]"
            onClick={stop}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            className="size-10 shrink-0 flex items-center justify-center rounded-full bg-linear-to-r from-[#70d9b8] to-mint-end text-white cursor-pointer transition-[transform,filter] duration-[120ms] ease-standard enabled:hover:-translate-y-px enabled:active:scale-[0.96] disabled:saturate-[0.4] disabled:cursor-default"
            disabled={!typing}
            onClick={submit}
            aria-label="发送"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M14.5 1.5L7 9M14.5 1.5L9.5 14.5L7 9L1.5 6.5L14.5 1.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      {error !== null && (
        <button
          type="button"
          className="self-start flex items-center gap-1.5 px-1 bg-transparent cursor-pointer text-left"
          onClick={retry}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-[#f08fa4]" />
          <span className="text-[11px] leading-[17px] text-[#a6797f]">{error}·点击重试</span>
        </button>
      )}
    </div>
  )
}

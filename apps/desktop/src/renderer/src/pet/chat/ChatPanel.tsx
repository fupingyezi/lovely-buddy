import { useRef, type KeyboardEvent, type ReactElement } from 'react'
import { useChatStore } from '../../store/chatStore'
import { usePetStore } from '../../store/petStore'

interface Props {
  onClose: () => void
}

/** 聊天面板（窗口 chat 扩展区）：最近对话 + 输入框。data-interactive 保证穿透状态机可点。 */
export default function ChatPanel({ onClose }: Props): ReactElement {
  const items = useChatStore((s) => s.items)
  const sending = useChatStore((s) => s.sending)
  const error = useChatStore((s) => s.error)
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const inputRef = useRef<HTMLInputElement>(null)

  const currentSlug = (): string | undefined => {
    const { models, modelUrl } = usePetStore.getState()
    return models.find((m) => m.url === modelUrl)?.slug
  }

  const submit = (): void => {
    const input = inputRef.current
    if (!input) return
    const v = input.value.trim()
    if (!v) return
    input.value = ''
    void send(v, currentSlug())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
  }

  return (
    <div className="chat-panel" data-interactive onContextMenu={(e) => e.preventDefault()}>
      <div className="chat-head">
        <span>聊天</span>
        <button type="button" className="chat-close" title="收起" aria-label="收起" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="chat-messages">
        {items.length === 0 && <p className="chat-empty">和 AI桌宠 说点什么吧～</p>}
        {items.map((it, i) => (
          <div key={i} className={`chat-msg ${it.role}`}>
            {it.content}
          </div>
        ))}
        {error !== null && <div className="chat-error">{error}</div>}
      </div>
      <div className="chat-input-row">
        <input ref={inputRef} autoFocus data-interactive placeholder={sending ? '回复中…' : '按 Enter 发送'} onKeyDown={onKeyDown} />
        {sending ? (
          <button type="button" className="chat-stop" onClick={stop}>
            停止
          </button>
        ) : (
          <button type="button" className="chat-send" onClick={submit}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}

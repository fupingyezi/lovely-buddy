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
    <div className="chat-input-wrap" data-interactive onContextMenu={(e) => e.preventDefault()}>
      <div className={`chat-input${typing ? ' chat-input--typing' : ''}`}>
        <input
          autoFocus
          maxLength={4000}
          disabled={sending}
          placeholder={sending ? '回复中…' : '和我说点什么…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {typing && <span className="chat-count">{value.length}/4000 个字</span>}
        {sending ? (
          <button type="button" className="chat-stop" onClick={stop}>
            停止
          </button>
        ) : (
          <button type="button" className="chat-send" disabled={!typing} onClick={submit}>
            发送
          </button>
        )}
      </div>
      {error !== null && (
        <button type="button" className="chat-error" onClick={retry}>
          {error}·点击重试
        </button>
      )}
    </div>
  )
}

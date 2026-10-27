import { useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chatStore'
import { usePetStore } from '@/store/petStore'

/**
 * 对话历史同步：启动拉一次（后端未起不报错，等恢复后过渡刷新兜底）；
 * offline→online 恢复时对齐（服务端可能落了半截/新消息）；设置窗口清空对话广播刷新。
 */
export function useChatSync(): void {
  useEffect(() => {
    void useChatStore.getState().refresh()
  }, [])

  const status = usePetStore((s) => s.status)
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current === 'offline' && status === 'online') {
      void useChatStore.getState().refresh()
    }
    prevStatusRef.current = status
  }, [status])

  useEffect(() => window.lovelybuddy.onChatCleared(() => void useChatStore.getState().refresh()), [])
}

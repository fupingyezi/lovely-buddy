import { useEffect } from 'react'
import { usePetStore } from '@/store/petStore'

/** 后端健康轮询（5s）：写入 petStore.status/version，供状态展示与断线恢复检测消费。 */
export function useBackendHealth(): void {
  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      try {
        const runtime = await window.lovelybuddy.getRuntime()
        if (stopped) return
        const res = await fetch(`${runtime.baseUrl}/healthz`)
        const h = (await res.json()) as { status: string; db: string; version: string }
        if (stopped) return
        usePetStore.getState().setStatus(h.db === 'ok' ? 'online' : 'offline', h.version)
      } catch {
        if (!stopped) usePetStore.getState().setStatus('offline')
      }
    }
    void poll()
    timer = window.setInterval(() => void poll(), 5000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])
}

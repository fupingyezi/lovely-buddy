import { useEffect, useState, type ReactElement } from 'react'

interface Runtime {
  baseUrl: string
  token: string
  dev: boolean
}

interface Health {
  status: string
  db: string
  version: string
}

// M0：后端连接状态卡片。悬停时关闭点击穿透以便交互，离开后恢复穿透。
// M1 起穿透检测交给 Live2D hitTest，本组件只做状态展示。
export default function App(): ReactElement {
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    window.skyi.getRuntime().then(setRuntime).catch((e: unknown) => setErr(String(e)))
  }, [])

  useEffect(() => {
    if (!runtime) return
    let stopped = false
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`${runtime.baseUrl}/healthz`)
        const h = (await res.json()) as Health
        if (!stopped) {
          setHealth(h)
          setErr(null)
        }
      } catch (e) {
        if (!stopped) setErr(String(e))
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [runtime])

  const connected = health !== null && health.db === 'ok'

  return (
    <div
      className="status-card"
      onPointerEnter={() => window.skyi.setPassthrough(false)}
      onPointerLeave={() => window.skyi.setPassthrough(true)}
    >
      <span className={`dot ${connected ? 'ok' : 'bad'}`} />
      <span>
        {err !== null
          ? `后端离线（${err}）`
          : connected
            ? `天依在线 v${health!.version}`
            : '后端连接中…'}
      </span>
    </div>
  )
}

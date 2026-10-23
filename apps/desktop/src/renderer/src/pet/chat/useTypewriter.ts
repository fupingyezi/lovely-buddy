import { useEffect, useState } from 'react'

/** 打字机速度（字/秒）——流式输出通常快于 40cps，气泡靠它平滑 */
export const TYPE_CPS = 40

const TICK_MS = 30

/**
 * 打字机：目标文本增长时按固定字速追赶（流式追加期间平滑显示），追平停住。
 * target 置空立即复位（气泡隐藏/换条时）。
 */
export function useTypewriter(target: string): string {
  const [shown, setShown] = useState('')

  useEffect(() => {
    if (target === '') {
      setShown('')
      return
    }
    const id = window.setInterval(() => {
      setShown((prev) => {
        if (prev.length >= target.length) return prev
        const advance = Math.max(1, Math.round((TYPE_CPS * TICK_MS) / 1000))
        return target.slice(0, Math.min(target.length, prev.length + advance))
      })
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [target])

  return shown
}

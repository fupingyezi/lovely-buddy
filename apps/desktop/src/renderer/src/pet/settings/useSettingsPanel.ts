import { useEffect, useRef, useState } from 'react'

/** 设置面板目标尺寸（工作区夹紧时实际更小，面板 CSS 弹性自适应） */
export const SETTINGS_W = 960
export const SETTINGS_H = 600

/** 窗口需向左上扩展的量（装下目标面板尺寸） */
export function settingsExtras(winW: number, winH: number): { extraW: number; extraH: number } {
  return { extraW: Math.max(0, SETTINGS_W - winW), extraH: Math.max(0, SETTINGS_H - winH) }
}

/**
 * 设置面板状态机（对照 usePetMenu/useChatPanel）：
 * - 打开：窗口向左上扩到装下面板（key 'settings'，右下角固定，模型被面板覆盖）
 * - 递增令牌防「点开又立刻关掉」竞态；Esc / 点面板外关闭
 */
export function useSettingsPanel(): { open: boolean; openPanel: () => void; closePanel: () => void } {
  const [open, setOpen] = useState(false)
  const tokenRef = useRef(0)

  const openPanel = (): void => {
    const token = ++tokenRef.current
    const { extraW, extraH } = settingsExtras(window.innerWidth, window.innerHeight)
    void window.lovelybuddy.expandWindow('settings', extraW, extraH).then(() => {
      if (token !== tokenRef.current) return // 期间已关闭/重开
      setOpen(true)
    })
  }

  const closePanel = (): void => {
    tokenRef.current++
    setOpen(false)
    window.lovelybuddy.collapseWindow('settings')
    window.lovelybuddy.setPassthrough(true) // 立即恢复穿透，交给 usePassthrough 状态机接管
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Element && e.target.closest('[data-interactive]')) return
      closePanel()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePanel()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return { open, openPanel, closePanel }
}

import { useEffect, useRef, useState } from 'react'

// 菜单尺寸上限估算：窗口太小装不下菜单时按此向左上扩展（夹紧后的余量由主进程返回的实际尺寸兜底）
const MENU_W = 280
const MENU_H = 520

export interface MenuPos {
  x: number
  y: number
}

/**
 * 右键菜单状态机：
 * - openMenu：窗口不够菜单大就先向左上扩展（右下角固定，角色不动），再把菜单坐标夹紧放进窗口；
 *   递增令牌让「点开又立刻关掉」的竞态失效（expandWindow resolve 后不再 setMenu）。
 * - closeMenu：缩回窗口、恢复穿透（交给 usePassthrough 状态机接管）。
 * - 菜单打开期间：点菜单外（含模型本体）或 Esc 关闭。
 */
export function usePetMenu(): {
  menu: MenuPos | null
  openMenu: (clientX: number, clientY: number) => void
  closeMenu: () => void
} {
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const tokenRef = useRef(0)

  const openMenu = (cx: number, cy: number): void => {
    const token = ++tokenRef.current
    const extraW = Math.max(0, cx + MENU_W + 8 - window.innerWidth)
    const extraH = Math.max(0, cy + MENU_H + 8 - window.innerHeight)
    const sizeP =
      extraW > 0 || extraH > 0
        ? window.lovelybuddy.expandWindow(extraW, extraH)
        : Promise.resolve({ width: window.innerWidth, height: window.innerHeight })
    void sizeP.then((size) => {
      if (token !== tokenRef.current) return // 期间已关闭/重开
      setMenu({
        x: Math.max(4, Math.min(cx, size.width - MENU_W - 8)),
        y: Math.max(4, Math.min(cy, size.height - MENU_H - 8))
      })
    })
  }

  const closeMenu = (): void => {
    tokenRef.current++ // 使未完成的 openMenu 失效
    setMenu(null)
    window.lovelybuddy.collapseWindow()
    window.lovelybuddy.setPassthrough(true) // 立即恢复穿透，交给 usePassthrough 状态机接管
  }

  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Element && e.target.closest('[data-interactive]')) return
      closeMenu()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu])

  return { menu, openMenu, closeMenu }
}

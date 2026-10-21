import { useEffect, useRef, useState } from 'react'
import { planMenuPlacement } from './menuLayout'

export interface MenuPos {
  x: number
  y: number
}

/**
 * 右键菜单状态机：
 * - openMenu：菜单固定放窗口左上（角色正上方），按 menuLayout 向左上扩展窗口；
 *   模型在 resize 时补尺寸增量（live2d/windowAnchor），屏幕位置不动。
 *   递增令牌让「点开又立刻关掉」的竞态失效（expandWindow resolve 后不再 setMenu）。
 * - closeMenu：缩回窗口、恢复穿透（交给 usePassthrough 状态机接管）。
 * - 菜单打开期间：点菜单外（含模型本体——tap 由 interact 的屏幕坐标判定正常触发）
 *   或 Esc 关闭。
 */
export function usePetMenu(): {
  menu: MenuPos | null
  openMenu: () => void
  closeMenu: () => void
} {
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const tokenRef = useRef(0)

  const openMenu = (): void => {
    const token = ++tokenRef.current
    const { x, y, extraW, extraH } = planMenuPlacement(window.innerWidth)
    void window.lovelybuddy.expandWindow(extraW, extraH).then(() => {
      if (token !== tokenRef.current) return // 期间已关闭/重开
      setMenu({ x, y })
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

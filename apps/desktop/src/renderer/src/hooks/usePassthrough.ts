import { useEffect, useRef } from 'react'
import type { PetModel } from '../live2d/model'

const THROTTLE_MS = 50

/**
 * 指针移动（节流）→ 命中检测：在模型上关闭点击穿透、模型外恢复穿透。
 * 主进程 setIgnoreMouseEvents 带 forward:true，穿透时 mousemove 仍能到达，
 * 否则窗口会永久卡在穿透状态。
 * 带 data-interactive 的 UI 面板（菜单/占位）始终强制关闭穿透，保证可点。
 * 菜单打开时整窗强制不穿透（否则菜单外的那下点击会穿到桌面、菜单关不掉）。
 */
export function usePassthrough(pet: PetModel | null, menuOpen: boolean): void {
  const petRef = useRef(pet)
  petRef.current = pet
  const menuOpenRef = useRef(menuOpen)
  menuOpenRef.current = menuOpen

  useEffect(() => {
    let passthroughOn = false
    let lastCheck = 0

    const setPassthrough = (on: boolean): void => {
      if (passthroughOn !== on) {
        passthroughOn = on
        window.lovelybuddy.setPassthrough(on)
      }
    }

    const onMove = (e: PointerEvent): void => {
      const now = performance.now()
      if (now - lastCheck < THROTTLE_MS) return
      lastCheck = now

      if (e.target instanceof Element && e.target.closest('[data-interactive]')) {
        setPassthrough(false)
        return
      }
      // 菜单打开：整窗可交互（菜单外的点击用于关闭菜单，不能穿给桌面）
      const onModel = menuOpenRef.current ? true : (petRef.current?.hitTest(e.clientX, e.clientY) ?? false)
      setPassthrough(!onModel)
    }

    // 菜单状态切换时立即同步一次（不依赖指针移动），关闭后恢复穿透兜底。
    // 必须无条件发 IPC：cleanup 刚把主进程穿透置回 true，而新 effect 的本地
    // passthroughOn 初值是 false，走 setPassthrough 去重会被跳过，窗口从此
    // 卡在穿透态（移动照常到达、点击全部穿给桌面，菜单无法关闭）。
    passthroughOn = menuOpenRef.current ? false : true
    window.lovelybuddy.setPassthrough(passthroughOn)

    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      // 卸载兜底：恢复穿透（小窗口默认态），避免模型切换瞬间吞掉点击
      window.lovelybuddy.setPassthrough(true)
    }
  }, [menuOpen])
}

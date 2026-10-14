import { useEffect, useRef } from 'react'
import type { PetModel } from '../live2d/model'

const THROTTLE_MS = 50

/**
 * 指针移动（节流）→ 命中检测：在模型上关闭点击穿透、模型外恢复穿透。
 * 主进程 setIgnoreMouseEvents 带 forward:true，穿透时 mousemove 仍能到达，
 * 否则窗口会永久卡在穿透状态。
 * 带 data-interactive 的 UI 面板（设置/状态卡）始终强制关闭穿透，保证可点。
 */
export function usePassthrough(pet: PetModel | null): void {
  const petRef = useRef(pet)
  petRef.current = pet

  useEffect(() => {
    let passthroughOn = false
    let lastCheck = 0

    const onMove = (e: PointerEvent): void => {
      const now = performance.now()
      if (now - lastCheck < THROTTLE_MS) return
      lastCheck = now

      if (e.target instanceof Element && e.target.closest('[data-interactive]')) {
        if (passthroughOn) {
          passthroughOn = false
          window.skyi.setPassthrough(false)
        }
        return
      }
      const onModel = petRef.current?.hitTest(e.clientX, e.clientY) ?? false
      const want = !onModel
      if (want !== passthroughOn) {
        passthroughOn = want
        window.skyi.setPassthrough(want)
      }
    }

    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      // 卸载兜底：恢复穿透（小窗口默认态），避免模型切换瞬间吞掉点击
      window.skyi.setPassthrough(true)
    }
  }, [])
}

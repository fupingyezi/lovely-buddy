import type { PetModel } from '@/live2d/engine/model'

const TAP_MAX_DRIFT = 6 // px，位移小于该值视为点击

export interface PetInteraction {
  dispose(): void
}

/**
 * 拖拽 = 移动窗口（主进程按屏幕夹紧并持久化）；位移小于阈值 = 点击（播 tap 动作）；
 * 右键命中模型 = 弹菜单（onMenu 传窗口坐标点击处）；
 * macOS 无右键设备：Cmd/Ctrl+点击在 pointerdown 直接弹菜单（Chromium 对 Ctrl+点击补发的
 * contextmenu 被跳过，避免重复触发）。
 * 用 screenX/screenY 增量：窗口跟着指针走，跨窗口坐标系不漂移。
 * 拖拽全程用 window 级 pointermove/up（forward:true 保证穿透时 mousemove 仍可达）。
 */
export function setupPetInteraction(
  pet: PetModel,
  canvas: HTMLCanvasElement,
  onTap: () => void,
  onMenu: (clientX: number, clientY: number) => void
): PetInteraction {
  let dragging = false
  let moved = 0
  let lastX = 0
  let lastY = 0

  const onDown = (e: PointerEvent): void => {
    if (!pet.hitTest(e.clientX, e.clientY)) return
    // macOS 无右键设备：Cmd/Ctrl+点击等效右键 → 直接弹菜单（不拖拽、不 tap）
    if (e.metaKey || e.ctrlKey) {
      onMenu(e.clientX, e.clientY)
      return
    }
    if (e.button !== 0) return
    dragging = true
    moved = 0
    lastX = e.screenX
    lastY = e.screenY
    e.preventDefault()
  }

  const onMove = (e: PointerEvent): void => {
    if (!dragging) return
    const dx = e.screenX - lastX
    const dy = e.screenY - lastY
    lastX = e.screenX
    lastY = e.screenY
    moved += Math.abs(dx) + Math.abs(dy)
    // 阈值内的位移视为点击抖动，不动窗口；确认是拖拽后才开始跟手
    if (moved <= TAP_MAX_DRIFT) return
    if (dx !== 0 || dy !== 0) window.lovelybuddy.moveWindow(dx, dy)
  }

  const end = (): void => {
    if (!dragging) return
    dragging = false
    window.lovelybuddy.moveWindowEnd()
    if (moved <= TAP_MAX_DRIFT) onTap()
  }

  // 拖拽中若因穿透丢失 pointerup，靠 mousemove 的 buttons===0 收尾
  const onMouseMove = (e: MouseEvent): void => {
    if (dragging && e.buttons === 0) end()
  }

  // 右键命中模型 → 弹菜单；命中与否都吞掉浏览器默认菜单
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    // Cmd/Ctrl+点击已在 pointerdown 弹过菜单；Chromium 会对 Ctrl+点击补发 contextmenu，跳过防重复
    if (e.ctrlKey || e.metaKey) return
    if (dragging) return
    if (pet.hitTest(e.clientX, e.clientY)) onMenu(e.clientX, e.clientY)
  }

  canvas.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', end)
  window.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('contextmenu', onContextMenu)

  return {
    dispose(): void {
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('contextmenu', onContextMenu)
    }
  }
}

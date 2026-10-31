import { useEffect, useRef, useState } from 'react'
import { MENU_REQUIRED_W, menuRequiredHeight } from '@/pet/menuLayout'
import { waitForResize } from '@/live2d/window/waitForResize'
import { getActiveModel } from '@/live2d/engine/modelBus'
import { usePetStore } from '@/store/petStore'

/**
 * 右键菜单状态机：
 * - openMenu：扩展量由主进程权威计算（expandMenu 按真实 bounds 补宽，杜绝渲染进程
 *   stale innerWidth 竞态）；扩展 resolve 后再等一次 resize 落地（模型位移完成），
 *   菜单首帧即贴头顶；菜单位置由 PetMenu 按几何 store 响应式推导（锚角色头顶，
 *   聊天扩展叠加时不再飘到窗口左上）。
 * - closeMenu：缩回窗口、恢复穿透（交给 usePassthrough 状态机接管）。
 * - 菜单打开期间：点菜单外（含模型本体——tap 由 interact 的屏幕坐标判定正常触发）
 *   或 Esc 关闭；唯一例外是命中模型的 Cmd/Ctrl 点击——归 interact 的切换路径独占
 *   （双处理会让菜单先关后开，窗口横跳）。
 */
export function usePetMenu(): {
  menuOpen: boolean
  openMenu: () => void
  closeMenu: () => void
} {
  const [menuOpen, setMenuOpen] = useState(false)
  const tokenRef = useRef(0)

  const openMenu = (): void => {
    const token = ++tokenRef.current
    const n = usePetStore.getState().models.length // 打开瞬间的模型数（模型列表在运行期稳定）
    void window.lovelybuddy.expandMenu(MENU_REQUIRED_W, menuRequiredHeight(n)).then(async () => {
      if (token !== tokenRef.current) return // 期间已关闭/重开
      await waitForResize() // 窗口尺寸异步落地；超时兜底 300ms
      if (token !== tokenRef.current) return
      setMenuOpen(true)
    })
  }

  const closeMenu = (): void => {
    tokenRef.current++ // 使未完成的 openMenu 失效
    setMenuOpen(false)
    window.lovelybuddy.collapseWindow('menu')
    window.lovelybuddy.setPassthrough(true) // 立即恢复穿透，交给 usePassthrough 状态机接管
  }

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent): void => {
      // Cmd/Ctrl+点击命中模型 = 菜单切换，归 interact 的切换路径独占：同一 pointerdown
      // 被双处理时，本监听器先关菜单（离散事件同步重渲染），interact 随后读到
      // menuOpen=false 的新闭包会把菜单又重开——窗口连缩带扩来回跳。
      if (e.metaKey || e.ctrlKey) {
        if (getActiveModel()?.hitTest(e.clientX, e.clientY) === true) return
      }
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
  }, [menuOpen])

  return { menuOpen, openMenu, closeMenu }
}

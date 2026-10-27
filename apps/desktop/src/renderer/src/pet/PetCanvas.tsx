import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AvatarActions } from '../live2d/actions'
import { loadPetModel, releasePetModel, type PetModel } from '../live2d/model'
import { setupPetInteraction } from '../live2d/interact'
import { getActiveModel, setActiveModel } from '../live2d/modelBus'
import { usePassthrough } from '../hooks/usePassthrough'
import { usePetStore } from '../store/petStore'

interface Props {
  url: string | null
  name: string
  actions: AvatarActions | null
  /** 右键命中模型时回调（窗口坐标点击处），菜单打开/关闭由 App 决定 */
  onMenu: (clientX: number, clientY: number) => void
  /** 菜单是否打开（穿透状态机：打开时整窗强制不穿透） */
  menuOpen: boolean
  /** 聊天面板是否打开（同 menuOpen：打开时整窗强制不穿透） */
  chatOpen: boolean
}

/**
 * 画布常驻（PIXI stage 单例依赖它），模型切换/无模型时只换内容不卸载组件，
 * 避免"卸载时模型仍在加载"的泄漏。url 为 null 时画布全透明且可穿透。
 */
export default function PetCanvas({ url, name, actions, onMenu, menuOpen, chatOpen }: Props): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const prevUrlRef = useRef<string | null>(null)
  const onMenuRef = useRef(onMenu)
  onMenuRef.current = onMenu
  const [pet, setPet] = useState<PetModel | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const prevUrl = prevUrlRef.current
    prevUrlRef.current = url
    // 切换模型（含切到 null）：立即销毁已加载的旧实例，加载中的交给 releasePetModel
    if (prevUrl !== null && prevUrl !== url) {
      void releasePetModel(prevUrl)
      setPet(null)
    }

    if (url === null) return

    let alive = true
    let instance: PetModel | null = null

    void loadPetModel(canvas, url, name, actions ?? undefined)
      .then((p) => {
        // StrictMode 重放：同一实例由存活的效果接管，不在这里销毁
        if (!alive) return
        instance = p
        setPet(p)
        usePetStore.getState().setModelError(null)
        console.info('[lovely-buddy] Live2D 模型已加载:', name, url)
      })
      .catch((e: unknown) => {
        if (alive) usePetStore.getState().setModelError(String(e))
        console.error('[lovely-buddy] Live2D 模型加载失败:', e instanceof Error ? e.stack : e)
      })

    return () => {
      alive = false
      // 切换/卸载时实例已解析则走 releasePetModel：销毁并同步清 cache。
      // 若只 instance.destroy()，模块级 cache 仍持有已销毁 facade 的 Promise，
      // 重挂载（HMR）后 loadPetModel 命中缓存返回死实例 → 人物永久消失。
      // StrictMode 重放时 instance 尚未解析，安全跳过（加载中的由下个存活效果接管）。
      if (instance) void releasePetModel(url)
    }
  }, [url, name])

  // 模型实例登记到总线（气泡播放动作用）；卸载/切换时清空
  useEffect(() => {
    setActiveModel(pet)
    return () => {
      if (getActiveModel() === pet) setActiveModel(null)
    }
  }, [pet])

  // 拖拽移动 + 点击播 tap 动作 + 右键弹菜单
  useEffect(() => {
    const canvas = canvasRef.current
    if (!pet || !canvas) return
    const interaction = setupPetInteraction(
      pet,
      canvas,
      () => {
        pet.notifyInteraction()
        void pet.playIntent('tap')
      },
      (x, y) => onMenuRef.current(x, y)
    )
    return () => interaction.dispose()
  }, [pet])

  usePassthrough(pet, menuOpen || chatOpen)

  return <canvas ref={canvasRef} className="pet-canvas fixed inset-0 block h-full w-full" />
}

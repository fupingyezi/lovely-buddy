// 窗口几何单一事实来源：所有"角色/窗口相对位置"的定位（气泡、菜单）都在渲染期
// 从这里响应式推导，而不是各自监听 resize——各监听器的执行顺序会读到
// "模型还没位移的旧锚点 + 新窗口尺寸"（SpeechBubble 注册早于模型位移监听器），
// 造成气泡不可见/错位。React 渲染晚于整个事件分发，anchor 读取时位移已完成。
import { create } from 'zustand'
import { useEffect } from 'react'

export interface WindowSize {
  w: number
  h: number
}

interface WindowGeometryState {
  /** 当前窗口尺寸（resize 事件同步；初始为 store 创建时的值，挂载后由 hook 校正） */
  size: WindowSize
  /** 模型基准窗口尺寸（model.ts 在模型加载/释放时发布）；无模型为 null */
  base: WindowSize | null
}

export const useWindowGeometry = create<WindowGeometryState>()(() => ({
  size: { w: window.innerWidth, h: window.innerHeight },
  base: null
}))

export function setWindowSize(w: number, h: number): void {
  useWindowGeometry.setState({ size: { w, h } })
}

export function setModelBase(base: WindowSize | null): void {
  useWindowGeometry.setState({ base })
}

/** App 挂载时注册：resize 事件 → 同步 size（含初始一次校正） */
export function useWindowGeometrySync(): void {
  useEffect(() => {
    const sync = (): void => setWindowSize(window.innerWidth, window.innerHeight)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])
}

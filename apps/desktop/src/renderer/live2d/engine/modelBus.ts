// 模型实例总线：PetCanvas 加载/销毁时登记，气泡等 UI 借此驱动模型播动作与锚点定位。
// zustand 化（原模块变量无订阅能力）：SpeechBubble 需在模型就绪时重渲染以重算布局。
// PetModel 是命令式 facade（pixi 句柄），只有"就绪/释放"两态变化，订阅开销可忽略。
import { create } from 'zustand'
import type { PetModel } from '@/live2d/engine/model'

export const useActiveModel = create<{ model: PetModel | null }>()(() => ({ model: null }))

export function setActiveModel(pet: PetModel | null): void {
  useActiveModel.setState({ model: pet })
}

export function getActiveModel(): PetModel | null {
  return useActiveModel.getState().model
}

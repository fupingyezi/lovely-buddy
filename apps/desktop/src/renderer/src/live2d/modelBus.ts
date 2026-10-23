// 模型实例总线：PetCanvas 加载/销毁时登记，气泡等 UI 借此驱动模型播动作。
// 不用 zustand：PetModel 是命令式 facade（pixi 句柄），进 store 只会引来无意义的重渲染。
import type { PetModel } from './model'

let active: PetModel | null = null

export function setActiveModel(pet: PetModel | null): void {
  active = pet
}

export function getActiveModel(): PetModel | null {
  return active
}

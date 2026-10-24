import { describe, expect, it } from 'vitest'
import { getActiveModel, setActiveModel, useActiveModel } from '../modelBus'
import type { PetModel } from '../model'

const fakePet = { anchor: { x: 0, y: 0 } } as unknown as PetModel

describe('modelBus', () => {
  it('set/get 往返', () => {
    setActiveModel(fakePet)
    expect(getActiveModel()).toBe(fakePet)
    setActiveModel(null)
    expect(getActiveModel()).toBeNull()
  })

  it('set 通知订阅者（气泡布局依赖模型就绪重渲染）', () => {
    const seen: Array<PetModel | null> = []
    const unsub = useActiveModel.subscribe((s) => seen.push(s.model))
    setActiveModel(fakePet)
    setActiveModel(null)
    unsub()
    expect(seen).toEqual([fakePet, null])
  })
})

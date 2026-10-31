import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setModelBase, setWindowSize, useWindowGeometry, useWindowGeometrySync } from '@/live2d/window/windowGeometry'
import { setActiveModel } from '@/live2d/engine/modelBus'
import type { PetModel } from '@/live2d/engine/model'

describe('windowGeometry', () => {
  it('setModelBase 发布/清除模型基准尺寸', () => {
    setModelBase({ w: 300, h: 480 })
    expect(useWindowGeometry.getState().base).toEqual({ w: 300, h: 480 })
    setModelBase(null)
    expect(useWindowGeometry.getState().base).toBeNull()
  })

  it('useWindowGeometrySync：挂载即同步尺寸，resize 事件更新 store，卸载后不再同步', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true })
    const { unmount } = renderHook(() => useWindowGeometrySync())
    expect(useWindowGeometry.getState().size).toEqual({ w: 500, h: 300 })

    Object.defineProperty(window, 'innerWidth', { value: 640, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(useWindowGeometry.getState().size).toEqual({ w: 640, h: 300 })

    unmount()
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(useWindowGeometry.getState().size).toEqual({ w: 640, h: 300 }) // 卸载后保持
    setWindowSize(1024, 768) // 复位，不影响其他测试
  })

  it('总线上有模型时 resize 让位：不直写尺寸（模型侧先位移再统一更新，防错位帧），无模型恢复直写', () => {
    setActiveModel({ hitTest: () => false } as unknown as PetModel)
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true })
    const { unmount } = renderHook(() => useWindowGeometrySync())
    setWindowSize(100, 100) // 预置可区分的旧值

    Object.defineProperty(window, 'innerWidth', { value: 640, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(useWindowGeometry.getState().size).toEqual({ w: 100, h: 100 }) // 未被 resize 直写

    setActiveModel(null)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(useWindowGeometry.getState().size).toEqual({ w: 640, h: 300 }) // 无模型照常同步

    unmount()
    setWindowSize(1024, 768) // 复位，不影响其他测试
  })
})

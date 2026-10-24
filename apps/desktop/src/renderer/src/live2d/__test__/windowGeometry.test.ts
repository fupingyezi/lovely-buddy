import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setModelBase, setWindowSize, useWindowGeometry, useWindowGeometrySync } from '../windowGeometry'

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
})

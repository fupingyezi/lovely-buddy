import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_H, SETTINGS_W, settingsExtras, useSettingsPanel } from '../useSettingsPanel'

const expandWindow = vi.fn()
const collapseWindow = vi.fn()
const setPassthrough = vi.fn()

function mockLovelybuddy(): void {
  expandWindow.mockReset().mockResolvedValue({ width: 1024, height: 768 })
  collapseWindow.mockReset()
  setPassthrough.mockReset()
  vi.stubGlobal('lovelybuddy', { expandWindow, collapseWindow, setPassthrough })
}

describe('settingsExtras', () => {
  it('小窗口（haru 164px 宽）：扩展到装下 960×600 面板', () => {
    expect(settingsExtras(164, 400)).toEqual({ extraW: 960 - 164, extraH: 600 - 400 })
    expect(SETTINGS_W).toBe(960)
    expect(SETTINGS_H).toBe(600)
  })

  it('窗口已够大：不再扩展', () => {
    expect(settingsExtras(1024, 768)).toEqual({ extraW: 0, extraH: 0 })
  })
})

describe('useSettingsPanel', () => {
  beforeEach(mockLovelybuddy)
  afterEach(() => vi.unstubAllGlobals())

  it('openPanel 用 settings 键位扩展窗口，完成后 open=true', async () => {
    const { result } = renderHook(() => useSettingsPanel())
    act(() => result.current.openPanel())
    expect(expandWindow).toHaveBeenCalledWith('settings', 0, 0) // jsdom 1024×768 已够大
    await waitFor(() => expect(result.current.open).toBe(true))
  })

  it('closePanel 缩回并恢复穿透', async () => {
    const { result } = renderHook(() => useSettingsPanel())
    act(() => result.current.openPanel())
    await waitFor(() => expect(result.current.open).toBe(true))
    act(() => result.current.closePanel())
    expect(result.current.open).toBe(false)
    expect(collapseWindow).toHaveBeenCalledWith('settings')
    expect(setPassthrough).toHaveBeenCalledWith(true)
  })

  it('Esc / 点面板外关闭', async () => {
    const { result } = renderHook(() => useSettingsPanel())
    act(() => result.current.openPanel())
    await waitFor(() => expect(result.current.open).toBe(true))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.open).toBe(false)
  })
})

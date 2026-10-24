import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupPetInteraction, type PetInteraction } from '../interact'
import type { PetModel } from '../model'

const moveWindow = vi.fn()
const moveWindowEnd = vi.fn()

/** 命中区域限定在画布左上 100x100，其余为透明区 */
function fakePet(): PetModel {
  return {
    name: 'fake',
    x: 0,
    y: 0,
    anchor: { x: 0, y: 0 },
    hitTest: (x, y) => x < 100 && y < 100,
    moveTo: vi.fn(),
    playIntent: () => Promise.resolve(true),
    destroy: vi.fn()
  }
}

describe('setupPetInteraction', () => {
  let canvas: HTMLCanvasElement
  let interaction: PetInteraction | null = null

  beforeEach(() => {
    vi.stubGlobal('lovelybuddy', { moveWindow, moveWindowEnd })
    moveWindow.mockClear()
    moveWindowEnd.mockClear()
    canvas = document.createElement('canvas')
  })

  afterEach(() => {
    interaction?.dispose()
    interaction = null
    vi.unstubAllGlobals()
  })

  it('模型上小位移松开 = 点击（播 tap，不移动窗口）', () => {
    const onTap = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, onTap, vi.fn())

    fireEvent.pointerDown(canvas, { button: 0, clientX: 50, clientY: 50, screenX: 500, screenY: 500 })
    fireEvent.pointerMove(window, { clientX: 52, clientY: 51, screenX: 502, screenY: 501 })
    fireEvent.pointerUp(window, { clientX: 52, clientY: 51, screenX: 502, screenY: 501 })

    expect(onTap).toHaveBeenCalledTimes(1)
    expect(moveWindow).not.toHaveBeenCalled()
    expect(moveWindowEnd).toHaveBeenCalledTimes(1)
  })

  it('模型上拖动 = 窗口按屏幕增量移动，松开不播 tap 并持久化', () => {
    const onTap = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, onTap, vi.fn())

    fireEvent.pointerDown(canvas, { button: 0, clientX: 50, clientY: 50, screenX: 500, screenY: 500 })
    fireEvent.pointerMove(window, { clientX: 70, clientY: 60, screenX: 520, screenY: 510 })
    fireEvent.pointerMove(window, { clientX: 75, clientY: 65, screenX: 525, screenY: 515 })
    fireEvent.pointerUp(window, { clientX: 75, clientY: 65, screenX: 525, screenY: 515 })

    expect(moveWindow).toHaveBeenNthCalledWith(1, 20, 10)
    expect(moveWindow).toHaveBeenNthCalledWith(2, 5, 5)
    expect(onTap).not.toHaveBeenCalled()
    expect(moveWindowEnd).toHaveBeenCalledTimes(1)
  })

  it('模型外按下不触发任何交互（点击直达桌面）', () => {
    const onTap = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, onTap, vi.fn())

    fireEvent.pointerDown(canvas, { button: 0, clientX: 150, clientY: 150, screenX: 600, screenY: 600 })
    fireEvent.pointerMove(window, { clientX: 160, clientY: 160, screenX: 610, screenY: 610 })
    fireEvent.pointerUp(window, { clientX: 160, clientY: 160, screenX: 610, screenY: 610 })

    expect(onTap).not.toHaveBeenCalled()
    expect(moveWindow).not.toHaveBeenCalled()
    expect(moveWindowEnd).not.toHaveBeenCalled()
  })

  it('右键命中模型 → onMenu 带点击坐标，且吞掉浏览器默认菜单', () => {
    const onTap = vi.fn()
    const onMenu = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, onTap, onMenu)

    const e = new MouseEvent('contextmenu', { clientX: 40, clientY: 60, bubbles: true, cancelable: true })
    canvas.dispatchEvent(e)

    expect(e.defaultPrevented).toBe(true)
    expect(onMenu).toHaveBeenCalledWith(40, 60)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('右键模型外 → 不弹菜单，但仍吞默认菜单', () => {
    const onMenu = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, vi.fn(), onMenu)

    const e = new MouseEvent('contextmenu', { clientX: 150, clientY: 150, bubbles: true, cancelable: true })
    canvas.dispatchEvent(e)

    expect(e.defaultPrevented).toBe(true)
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('拖拽过程中右键不弹菜单', () => {
    const onMenu = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, vi.fn(), onMenu)

    fireEvent.pointerDown(canvas, { button: 0, clientX: 50, clientY: 50, screenX: 500, screenY: 500 })
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80, screenX: 530, screenY: 530 })

    fireEvent.contextMenu(canvas, { clientX: 80, clientY: 80 })
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('Cmd+点击命中模型 → 弹菜单（等效右键），松开不播 tap 不拖拽', () => {
    const onTap = vi.fn()
    const onMenu = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, onTap, onMenu)

    fireEvent.pointerDown(canvas, { button: 0, metaKey: true, clientX: 40, clientY: 60, screenX: 500, screenY: 500 })
    fireEvent.pointerUp(window, { clientX: 40, clientY: 60, screenX: 500, screenY: 500 })

    expect(onMenu).toHaveBeenCalledWith(40, 60)
    expect(onTap).not.toHaveBeenCalled()
    expect(moveWindow).not.toHaveBeenCalled()
  })

  it('Ctrl+点击命中模型 → 弹菜单；Chromium 补发的 contextmenu 不重复触发', () => {
    const onTap = vi.fn()
    const onMenu = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, onTap, onMenu)

    fireEvent.pointerDown(canvas, { button: 0, ctrlKey: true, clientX: 40, clientY: 60, screenX: 500, screenY: 500 })
    const e = new MouseEvent('contextmenu', { clientX: 40, clientY: 60, ctrlKey: true, bubbles: true, cancelable: true })
    canvas.dispatchEvent(e)
    fireEvent.pointerUp(window, { clientX: 40, clientY: 60, screenX: 500, screenY: 500 })

    expect(e.defaultPrevented).toBe(true)
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(onMenu).toHaveBeenCalledWith(40, 60)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('Cmd+点击模型外 → 不弹菜单', () => {
    const onMenu = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, vi.fn(), onMenu)

    fireEvent.pointerDown(canvas, { button: 0, metaKey: true, clientX: 150, clientY: 150, screenX: 600, screenY: 600 })

    expect(onMenu).not.toHaveBeenCalled()
  })

  it('dispose 后不再响应拖拽', () => {
    const onTap = vi.fn()
    interaction = setupPetInteraction(fakePet(), canvas, onTap, vi.fn())
    interaction.dispose()

    fireEvent.pointerDown(canvas, { button: 0, clientX: 50, clientY: 50, screenX: 500, screenY: 500 })
    fireEvent.pointerMove(window, { clientX: 70, clientY: 60, screenX: 520, screenY: 510 })
    fireEvent.pointerUp(window, { clientX: 70, clientY: 60, screenX: 520, screenY: 510 })

    expect(onTap).not.toHaveBeenCalled()
    expect(moveWindow).not.toHaveBeenCalled()
  })
})

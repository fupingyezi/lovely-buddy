import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PetMenu from '@/pet/PetMenu'
import { usePetStore } from '@/store/petStore'
import { useWindowGeometry } from '@/live2d/window/windowGeometry'
import { listHeight, MAX_LIST_ROWS, menuHeight, menuTop } from '@/pet/menuLayout'

function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', {
    getRuntime: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:8740', token: 'dev', dev: true }),
    setPassthrough: vi.fn()
  })
}

// AvatarInfo 是 env.d.ts 的全局类型（declare global），不从 assetsApi import
const haruAvatar: AvatarInfo = {
  slug: 'haru',
  name: 'haru-cubism4',
  url: 'l2d://model/haru/haru.model3.json',
  kind: 'moc3',
  entry: 'haru/haru.model3.json',
  license: 'free',
  source: 'local'
}
const shizukuAvatar: AvatarInfo = {
  slug: 'shizuku',
  name: 'shizuku-cubism2',
  url: 'l2d://model/shizuku/shizuku.model.json',
  kind: 'moc',
  entry: 'shizuku/shizuku.model.json'
}
function modelN(n: number): AvatarInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `m${i}`,
    name: `model-${i}`,
    url: `l2d://model/m${i}/m${i}.model3.json`,
    kind: 'moc3',
    entry: `m${i}/m${i}.model3.json`
  }))
}

function renderMenu(onClose = vi.fn(), onSettings = vi.fn()): ReturnType<typeof vi.fn> {
  render(<PetMenu onClose={onClose} onChat={() => {}} onSettings={onSettings} />)
  return onClose
}

describe('PetMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    usePetStore.setState({
      models: [haruAvatar, shizukuAvatar],
      modelUrl: haruAvatar.url,
      modelName: haruAvatar.name,
      modelError: null,
      placeholderDismissed: false,
      importing: false,
      importError: null,
      status: 'online',
      version: '0.4.1'
    })
    mockLovelybuddy()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('菜单右贴窗口、底边距头顶 8px、高度随形象数自适应（几何响应式）', () => {
    useWindowGeometry.setState({ size: { w: 820, h: 932 }, base: { w: 300, h: 480 } })
    render(<PetMenu onClose={() => {}} onChat={() => {}} onSettings={() => {}} />)
    const el = screen.getByTitle('关闭菜单').closest('.pet-menu') as HTMLElement
    expect(el.style.top).toBe(`${menuTop(452, 2)}px`) // 932 - 480 = 452（聊天扩展在身）
    expect(el.style.right).toBe('4px')
    expect(el.style.height).toBe(`${menuHeight(2)}px`) // 186
    useWindowGeometry.setState({ base: null, size: { w: 1024, h: 768 } })
  })

  it('✕ 按钮关闭菜单', () => {
    const onClose = renderMenu()
    fireEvent.click(screen.getByTitle('关闭菜单'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('聊天按钮触发 onChat；设置按钮触发 onSettings', () => {
    const onChat = vi.fn()
    const onSettings = vi.fn()
    render(<PetMenu onClose={() => {}} onChat={onChat} onSettings={onSettings} />)
    fireEvent.click(screen.getByRole('button', { name: '聊天' }))
    expect(onChat).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(onSettings).toHaveBeenCalled()
  })

  it('状态行显示在线状态与版本', () => {
    renderMenu()
    expect(screen.getByText(/AI桌宠在线/).textContent).toContain('0.4.1')
  })

  it('多形象列出缩略行：当前项高亮带勾，点击切换并关闭菜单', async () => {
    const onClose = renderMenu()
    // active 类在行按钮上，名称文字在内层 span
    expect(screen.getByText('haru-cubism4').closest('button')?.className).toContain('active')
    expect(screen.getByText('shizuku-cubism2').closest('button')?.className).not.toContain('active')
    fireEvent.click(screen.getByText('shizuku-cubism2'))
    await waitFor(() => {
      expect(usePetStore.getState().modelUrl).toBe(shizukuAvatar.url)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('单形象紧凑态：无列表区，高度 87', () => {
    usePetStore.setState({ models: [haruAvatar] })
    renderMenu()
    expect(screen.queryByText('shizuku-cubism2')).toBeNull()
    const el = screen.getByTitle('关闭菜单').closest('.pet-menu') as HTMLElement
    expect(el.style.height).toBe('87px')
  })

  it('超过 4 个形象列表区封顶内部滚动', () => {
    usePetStore.setState({ models: modelN(5) })
    renderMenu()
    const el = screen.getByTitle('关闭菜单').closest('.pet-menu') as HTMLElement
    expect(el.style.height).toBe(`${menuHeight(5)}px`) // 与 4 个相同
    const list = screen.getByText('model-0').parentElement?.parentElement as HTMLElement
    expect(list.style.maxHeight).toBe(`${listHeight(MAX_LIST_ROWS)}px`)
  })

  it('离线：状态点转蜜桃、聊天键降饱和禁用', () => {
    usePetStore.setState({ status: 'offline' })
    renderMenu()
    expect(screen.getByText('后端离线')).toBeTruthy()
    const chat = screen.getByRole('button', { name: '聊天' }) as HTMLButtonElement
    expect(chat.disabled).toBe(true)
    expect(chat.className).toContain('bg-[#f5f2ee]')
  })

  it('入口收敛：无导入/删除按钮', () => {
    renderMenu()
    expect(screen.queryByText('导入形象')).toBeNull()
    expect(screen.queryByText('删除当前形象')).toBeNull()
  })

  it('有自带预览图的形象渲染真实图缩略，无则 zwt.webp 占位；真实图加载失败换占位', () => {
    usePetStore.setState({ models: [{ ...haruAvatar, thumbUrl: 'l2d://model/haru/icon.png' }, shizukuAvatar] })
    // 缩略图是装饰图（alt=""），无 img role；直接断言渲染出的 img 元素
    renderMenu()
    const imgs = document.querySelectorAll('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0].getAttribute('src')).toBe('l2d://model/haru/icon.png')
    expect(imgs[1].getAttribute('src')).toBe('zwt.webp')
    fireEvent.error(imgs[0])
    expect(imgs[0].getAttribute('src')).toBe('zwt.webp')
  })
})

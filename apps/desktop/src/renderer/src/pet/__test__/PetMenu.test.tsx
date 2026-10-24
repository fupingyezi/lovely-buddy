import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PetMenu from '../PetMenu'
import { usePetStore } from '../../store/petStore'
import { useWindowGeometry } from '../../live2d/windowGeometry'

function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', {
    getRuntime: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:8740', token: 'dev', dev: true }),
    setPassthrough: vi.fn(),
    quit: vi.fn(),
    moveWindow: vi.fn(),
    moveWindowEnd: vi.fn(),
    resizeWindow: vi.fn(),
    expandWindow: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
    collapseWindow: vi.fn(),
    pickImportPath: vi.fn().mockResolvedValue({ canceled: true, path: null })
  })
}

/** fetch 按 URL 路由到有状态的假后端（assets + healthz） */
function mockFetchApi(
  avatars: unknown[],
  importResult?: { ok: boolean; avatar?: Record<string, unknown>; error?: string }
): void {
  let list: Array<Record<string, unknown>> = [...avatars] as Array<Record<string, unknown>>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      if (url === 'http://127.0.0.1:8740/api/v1/assets' && method === 'GET') return json({ avatars: list })
      if (url === 'http://127.0.0.1:8740/api/v1/assets/import' && method === 'POST') {
        if (importResult && !importResult.ok) return json({ error: importResult.error }, 422)
        const avatar = (importResult?.avatar ?? avatars[0]) as Record<string, unknown> | undefined
        if (avatar && !list.some((a) => a.slug === avatar.slug)) list = [...list, avatar]
        return json({ avatar })
      }
      if (url.startsWith('http://127.0.0.1:8740/api/v1/assets/') && method === 'DELETE') {
        const slug = decodeURIComponent(url.split('/').pop() ?? '')
        list = list.filter((a) => a.slug !== slug)
        return json({ ok: true })
      }
      return json({}, 404)
    })
  )
}

const haruAvatar: AvatarInfo = { slug: 'haru', name: 'haru-cubism4', url: 'l2d://model/haru/haru.model3.json', kind: 'moc3', entry: 'haru/haru.model3.json', license: 'free', source: 'local' }
const shizukuAvatar: AvatarInfo = { slug: 'shizuku', name: 'shizuku-cubism2', url: 'l2d://model/shizuku/shizuku.model.json', kind: 'moc', entry: 'shizuku/shizuku.model.json' }

function renderMenu(onClose = vi.fn(), onSettings = vi.fn()): ReturnType<typeof vi.fn> {
  render(<PetMenu onClose={onClose} onChat={() => {}} onSettings={onSettings} />)
  return onClose
}

describe('PetMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    usePetStore.setState({
      models: [],
      modelUrl: null,
      modelName: null,
      modelError: null,
      placeholderDismissed: false,
      importing: false,
      importError: null,
      status: 'connecting',
      version: null
    })
    mockLovelybuddy()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('菜单右贴窗口、底边距头顶 8px（几何响应式）', () => {
    useWindowGeometry.setState({ size: { w: 820, h: 932 }, base: { w: 300, h: 480 } })
    render(<PetMenu onClose={() => {}} onChat={() => {}} onSettings={() => {}} />)
    const el = screen.getByTitle('关闭菜单').closest('.pet-menu') as HTMLElement
    expect(el.style.top).toBe('124px') // 932 - 480 - 8 - 320（聊天扩展在身）
    expect(el.style.right).toBe('4px')
    useWindowGeometry.setState({ base: null, size: { w: 1024, h: 768 } })
  })

  it('✕ 按钮关闭菜单', () => {
    const onClose = renderMenu()
    fireEvent.click(screen.getByTitle('关闭菜单'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('聊天按钮触发 onChat', () => {
    const onChat = vi.fn()
    render(<PetMenu onClose={() => {}} onChat={onChat} onSettings={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '聊天' }))
    expect(onChat).toHaveBeenCalled()
  })

  it('设置按钮触发 onSettings', () => {
    const onSettings = vi.fn()
    renderMenu(vi.fn(), onSettings)
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(onSettings).toHaveBeenCalled()
  })

  it('状态行显示在线状态与版本', () => {
    usePetStore.setState({ status: 'online', version: '0.1.0-dev' })
    renderMenu()
    expect(screen.getByText(/AI桌宠在线/).textContent).toContain('0.1.0-dev')
  })

  it('多形象时列出切换列表，点击切换并关闭菜单', async () => {
    usePetStore.setState({ models: [haruAvatar, shizukuAvatar], modelUrl: haruAvatar.url, modelName: haruAvatar.name })
    const onClose = renderMenu()

    expect(screen.getByText('haru-cubism4').className).toContain('active')

    fireEvent.click(screen.getByText('shizuku-cubism2'))
    await waitFor(() => {
      expect(usePetStore.getState().modelUrl).toBe(shizukuAvatar.url)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('导入形象展开面板，URL 导入成功后关闭菜单', async () => {
    mockFetchApi([haruAvatar], {
      ok: true,
      avatar: { slug: 'haru', name: 'haru', kind: 'moc3', entry: 'haru/haru.model3.json', source: 'url' }
    })
    usePetStore.setState({ models: [haruAvatar], modelUrl: haruAvatar.url, modelName: haruAvatar.name })
    const onClose = renderMenu()

    fireEvent.click(screen.getByText('导入形象'))
    fireEvent.change(screen.getByPlaceholderText('粘贴 https://…zip 链接'), {
      target: { value: ' https://example.com/haru.zip ' }
    })
    fireEvent.click(screen.getByText('从 URL 导入'))

    await waitFor(() => {
      expect(usePetStore.getState().modelUrl).toBe('l2d://model/haru/haru.model3.json')
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('导入失败显示后端错误，菜单不关闭', async () => {
    mockFetchApi([], { ok: false, error: 'zip 含非法路径: ../../evil.txt' })
    usePetStore.setState({ modelUrl: 'l2d://x', modelName: 'x' })
    const onClose = renderMenu()

    fireEvent.click(screen.getByText('导入形象'))
    fireEvent.change(screen.getByPlaceholderText('粘贴 https://…zip 链接'), {
      target: { value: 'https://example.com/evil.zip' }
    })
    fireEvent.click(screen.getByText('从 URL 导入'))

    await waitFor(() => {
      expect(screen.getByText('zip 含非法路径: ../../evil.txt')).toBeTruthy()
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('删除当前形象（二次确认）后切换到剩余形象', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockFetchApi([haruAvatar, shizukuAvatar])
    usePetStore.setState({ models: [haruAvatar, shizukuAvatar], modelUrl: haruAvatar.url, modelName: haruAvatar.name })
    renderMenu()

    fireEvent.click(screen.getByText('删除当前形象'))
    await waitFor(() => {
      expect(usePetStore.getState().modelUrl).toBe(shizukuAvatar.url)
    })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/v1/assets/haru') && c[1]?.method === 'DELETE')
    ).toBe(true)
  })
})

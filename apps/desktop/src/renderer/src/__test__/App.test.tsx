import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../App'
import { usePetStore } from '../store/petStore'

// 该库在 import 时就要求 window.Live2D 存在（jsdom 没有），App 测试不涉及真实渲染，整体 mock 掉
vi.mock('pixi-live2d-display-lipsyncpatch', () => ({ Live2DModel: class {} }))

function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', {
    getRuntime: vi.fn().mockResolvedValue({
      baseUrl: 'http://127.0.0.1:8740',
      token: 'dev',
      dev: true
    }),
    setPassthrough: vi.fn(),
    quit: vi.fn(),
    moveWindow: vi.fn(),
    moveWindowEnd: vi.fn(),
    resizeWindow: vi.fn(),
    pickImportPath: vi.fn().mockResolvedValue({ canceled: true, path: null })
  })
}

/** fetch 按 URL 路由到有状态的假后端（assets + healthz） */
function mockFetchApi(
  avatars: Array<Record<string, unknown>>,
  importResult?: { ok: boolean; avatar?: Record<string, unknown>; error?: string }
): void {
  let list: Array<Record<string, unknown>> = [...avatars]
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
        const avatar = importResult?.avatar ?? avatars[0]
        if (avatar && !list.some((a) => a.slug === avatar.slug)) list = [...list, avatar]
        return json({ avatar })
      }
      if (url.startsWith('http://127.0.0.1:8740/api/v1/assets/') && method === 'DELETE') {
        const slug = decodeURIComponent(url.split('/').pop() ?? '')
        list = list.filter((a) => a.slug !== slug)
        return json({ ok: true })
      }
      if (url === 'http://127.0.0.1:8740/healthz') return json({ status: 'ok', db: 'ok', version: '0.1.0-dev' })
      return json({}, 404)
    })
  )
}

const haruAvatar = { slug: 'haru', name: 'haru-cubism4', kind: 'moc3', entry: 'haru/haru.model3.json', license: 'free', source: 'local' }
const shizukuAvatar = { slug: 'shizuku', name: 'shizuku-cubism2', kind: 'moc', entry: 'shizuku/shizuku.model.json' }
const mikuAvatar = { slug: 'miku', name: 'miku-cubism4', kind: 'moc3', entry: 'miku/miku.model3.json' }

function renderApp(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  )
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    // zustand store 是模块级单例，测试间必须复位
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
    mockFetchApi([])
    // usePassthrough 有 50ms 节流，让每次 pointermove 的时间戳都不同
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 1000))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('后端健康时显示“天依在线 v版本”', async () => {
    renderApp()
    await waitFor(() => {
      expect(screen.getByText(/天依在线/).textContent).toContain('0.1.0-dev')
    })
  })

  it('后端不可达时显示离线提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    renderApp()
    await waitFor(() => {
      expect(screen.getByText(/后端离线/)).toBeTruthy()
    })
  })

  it('无模型时显示占位卡片，可重新扫描', async () => {
    renderApp()
    await screen.findByText('未找到 Live2D 模型')
    fireEvent.click(screen.getByText('重新扫描'))
    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
      const listCalls = fetchMock.mock.calls.filter(
        (c) => String(c[0]) === 'http://127.0.0.1:8740/api/v1/assets' && !c[1]?.method
      )
      expect(listCalls.length).toBeGreaterThanOrEqual(2) // 挂载 1 次 + 手动 1 次
    })
  })

  it('点击关闭按钮后占位卡消失，且扫描不到模型也不再弹出', async () => {
    renderApp()
    fireEvent.click(await screen.findByTitle('暂不显示'))
    await waitFor(() => {
      expect(screen.queryByText('未找到 Live2D 模型')).toBeNull()
    })
    // 再次挂载（重新扫描仍为空）也不弹
    cleanup()
    renderApp()
    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/v1/assets'))).toBe(true)
    })
    expect(screen.queryByText('未找到 Live2D 模型')).toBeNull()
  })

  it('有多个模型时显示切换器，点击切换模型', async () => {
    mockFetchApi([haruAvatar, shizukuAvatar])
    renderApp()
    await screen.findByText('haru-cubism4') // 默认选中第一个
    expect(screen.getByText('haru-cubism4').className).toContain('active')

    fireEvent.click(screen.getByText('shizuku-cubism2'))
    await waitFor(() => {
      expect(screen.getByText('shizuku-cubism2').className).toContain('active')
      expect(document.querySelector('.pet-canvas')).toBeTruthy()
    })
  })

  it('指针在 UI 面板上关闭穿透，模型外恢复穿透', async () => {
    mockFetchApi([haruAvatar])
    renderApp()
    // 有模型才会渲染 PetCanvas（usePassthrough 挂在其中）
    await waitFor(() => {
      expect(document.querySelector('.pet-canvas')).toBeTruthy()
    })
    const statusCard = (await screen.findByText(/天依在线|后端连接中|后端离线/)).closest('.status-card')!

    // 模型外（canvas 空白处，pet 尚未加载 → 无命中）→ 恢复穿透
    fireEvent.pointerMove(document.querySelector('.pet-canvas')!, { clientX: 5, clientY: 5 })
    expect(window.lovelybuddy.setPassthrough).toHaveBeenLastCalledWith(true)

    // UI 面板（data-interactive）→ 关闭穿透，保证可点
    fireEvent.pointerMove(statusCard, { clientX: 400, clientY: 400 })
    expect(window.lovelybuddy.setPassthrough).toHaveBeenLastCalledWith(false)

    // 离开面板 → 恢复穿透
    fireEvent.pointerMove(document.body, { clientX: 10, clientY: 10 })
    expect(window.lovelybuddy.setPassthrough).toHaveBeenLastCalledWith(true)
  })

  it('导入成功自动应用新形象', async () => {
    mockFetchApi([haruAvatar], {
      ok: true,
      avatar: { slug: 'tianyi', name: '天依', kind: 'moc3', entry: 'tianyi/tianyi.model3.json', source: 'url' }
    })
    renderApp()
    // 单模型不渲染切换器，等顶栏动作区出现即可
    await screen.findByText('导入形象')

    fireEvent.click(screen.getByText('导入形象'))
    fireEvent.change(screen.getByPlaceholderText('粘贴 https://…zip 链接'), {
      target: { value: ' https://example.com/tianyi.zip ' }
    })
    fireEvent.click(screen.getByText('从 URL 导入'))

    await waitFor(() => {
      expect(screen.getByText('天依').className).toContain('active')
    })
    // 自动应用：localStorage 记住新形象
    expect(localStorage.getItem('lovelybuddy:model-url')).toBe('l2d://model/tianyi/tianyi.model3.json')
    // POST body 正确（trim 后）
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const importCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/v1/assets/import'))
    expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({
      source: { type: 'url', value: 'https://example.com/tianyi.zip' }
    })
  })

  it('导入失败显示后端错误', async () => {
    mockFetchApi([], { ok: false, error: 'zip 含非法路径: ../../evil.txt' })
    renderApp()
    await screen.findByText('未找到 Live2D 模型')

    // 占位卡与顶栏各有一个「导入形象」，点占位卡里的（DOM 中在前）
    fireEvent.click(screen.getAllByText('导入形象')[0])
    fireEvent.change(screen.getByPlaceholderText('粘贴 https://…zip 链接'), {
      target: { value: 'https://example.com/evil.zip' }
    })
    fireEvent.click(screen.getByText('从 URL 导入'))

    await waitFor(() => {
      expect(screen.getByText('zip 含非法路径: ../../evil.txt')).toBeTruthy()
    })
    // 面板保持打开（未自动应用）
    expect(screen.getByText('从 URL 导入')).toBeTruthy()
  })

  it('删除当前形象后切换到剩余形象', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockFetchApi([haruAvatar, shizukuAvatar, mikuAvatar])
    renderApp()
    await screen.findByText('haru-cubism4')

    fireEvent.click(screen.getByText('删除当前形象'))
    await waitFor(() => {
      expect(screen.queryByText('haru-cubism4')).toBeNull()
    })
    // 剩余形象里第一个自动选中
    await waitFor(() => {
      expect(screen.getByText('shizuku-cubism2').className).toContain('active')
    })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/v1/assets/haru') && c[1]?.method === 'DELETE')
    ).toBe(true)
  })

  it('本地导入走文件选择对话框', async () => {
    mockFetchApi([], {
      ok: true,
      avatar: { slug: 'local', name: '本地形象', kind: 'moc', entry: 'local/x.model.json', source: 'local' }
    })
    ;(window.lovelybuddy.pickImportPath as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: false,
      path: '/tmp/x.zip'
    })
    renderApp()
    await screen.findByText('未找到 Live2D 模型')

    fireEvent.click(screen.getAllByText('导入形象')[0])
    fireEvent.click(screen.getByText('本地 zip'))

    // 导入成功 → 占位卡消失（模型已应用，单模型无切换器）
    await waitFor(() => {
      expect(screen.queryByText('未找到 Live2D 模型')).toBeNull()
    })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const importCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/v1/assets/import'))
    expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({
      source: { type: 'path', value: '/tmp/x.zip' }
    })
  })
})

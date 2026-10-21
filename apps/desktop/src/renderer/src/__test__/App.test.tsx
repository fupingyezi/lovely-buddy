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
    expandWindow: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
    collapseWindow: vi.fn(),
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
      if (url === 'http://127.0.0.1:8740/healthz') return json({ status: 'ok', db: 'ok', version: '0.1.0-dev' })
      return json({}, 404)
    })
  )
}

const haruAvatar = { slug: 'haru', name: 'haru-cubism4', url: 'l2d://model/haru/haru.model3.json', kind: 'moc3', entry: 'haru/haru.model3.json', license: 'free', source: 'local' }

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

  it('无模型时显示占位卡片（含内嵌导入面板），可重新扫描', async () => {
    renderApp()
    await screen.findByText('未找到 Live2D 模型')
    // 导入面板直接内嵌在占位卡里，不再有常驻顶栏
    expect(screen.getByPlaceholderText('粘贴 https://…zip 链接')).toBeTruthy()

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

  it('有模型时不渲染常驻设置面板（设置改由右键菜单承载）', async () => {
    mockFetchApi([haruAvatar])
    renderApp()
    await waitFor(() => {
      expect(document.querySelector('.pet-canvas')).toBeTruthy()
    })
    // 等待一轮列表加载完成
    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/v1/assets') && !c[1]?.method)
      ).toBe(true)
    })
    expect(document.querySelector('.pet-menu')).toBeNull()
    expect(screen.queryByText('导入形象')).toBeNull()
    expect(screen.queryByText(/天依在线|后端离线|后端连接中/)).toBeNull()
  })

  it('指针在占位卡上关闭穿透，模型外恢复穿透', async () => {
    renderApp()
    const placeholder = (await screen.findByText('未找到 Live2D 模型')).closest('.placeholder')!

    // 占位卡（data-interactive）→ 关闭穿透，保证可点
    fireEvent.pointerMove(placeholder, { clientX: 400, clientY: 400 })
    expect(window.lovelybuddy.setPassthrough).toHaveBeenLastCalledWith(false)

    // 离开面板 → 模型外（pet 尚未加载 → 无命中）→ 恢复穿透
    fireEvent.pointerMove(document.querySelector('.pet-canvas')!, { clientX: 5, clientY: 5 })
    expect(window.lovelybuddy.setPassthrough).toHaveBeenLastCalledWith(true)
  })

  it('占位卡导入成功自动应用新形象', async () => {
    mockFetchApi([], {
      ok: true,
      avatar: { slug: 'tianyi', name: '天依', kind: 'moc3', entry: 'tianyi/tianyi.model3.json', source: 'url' }
    })
    renderApp()
    await screen.findByText('未找到 Live2D 模型')

    fireEvent.change(screen.getByPlaceholderText('粘贴 https://…zip 链接'), {
      target: { value: ' https://example.com/tianyi.zip ' }
    })
    fireEvent.click(screen.getByText('从 URL 导入'))

    await waitFor(() => {
      expect(screen.queryByText('未找到 Live2D 模型')).toBeNull()
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

    fireEvent.click(screen.getByText('本地 zip'))

    // 导入成功 → 占位卡消失（模型已应用）
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

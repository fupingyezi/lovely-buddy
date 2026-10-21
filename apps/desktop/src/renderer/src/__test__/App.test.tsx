import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../App'
import { usePetStore } from '../store/petStore'

// 该库在 import 时就要求 window.Live2D 存在（jsdom 没有），App 测试不涉及真实渲染，整体 mock 掉
vi.mock('pixi-live2d-display-lipsyncpatch', () => ({ Live2DModel: class {} }))

function mockLovelybuddy(models: ModelInfo[] = []): void {
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
    listModels: vi.fn().mockResolvedValue(models),
    pickModelDir: vi.fn().mockResolvedValue(models)
  })
}

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
      status: 'connecting',
      version: null
    })
    mockLovelybuddy([])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ status: 'ok', db: 'ok', version: '0.1.0-dev' })
      })
    )
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
      expect(window.lovelybuddy.listModels).toHaveBeenCalledTimes(2) // 挂载 1 次 + 手动 1 次
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
      expect(window.lovelybuddy.listModels).toHaveBeenCalled()
    })
    expect(screen.queryByText('未找到 Live2D 模型')).toBeNull()
  })

  it('有多个模型时显示切换器，点击切换模型', async () => {
    const models: ModelInfo[] = [
      { name: 'haru-cubism4', url: 'l2d://model/haru/haru.model3.json', kind: 'moc3' },
      { name: 'shizuku-cubism2', url: 'l2d://model/shizuku/shizuku.model.json', kind: 'moc' }
    ]
    mockLovelybuddy(models)
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
    mockLovelybuddy([{ name: 'haru-cubism4', url: 'l2d://model/haru/haru.model3.json', kind: 'moc3' }])
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
})

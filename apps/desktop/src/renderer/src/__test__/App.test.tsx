import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../App'

function renderApp(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  )
}

describe('App 状态卡片', () => {
  beforeEach(() => {
    vi.stubGlobal('skyi', {
      getRuntime: vi.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:8740',
        token: 'dev',
        dev: true
      }),
      setPassthrough: vi.fn(),
      quit: vi.fn()
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ status: 'ok', db: 'ok', version: '0.1.0-dev' })
      })
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('后端健康时显示“天依在线”', async () => {
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

  it('悬停时关闭点击穿透，离开时恢复', async () => {
    renderApp()
    const card = await screen.findByText(/天依在线|后端连接中|后端离线/)
    const el = card.closest('.status-card') as HTMLElement

    // React 的 onPointerEnter/Leave 由 pointerover/pointerout 合成，需派发原生事件
    el.dispatchEvent(new Event('pointerover', { bubbles: true }))
    expect(window.skyi.setPassthrough).toHaveBeenCalledWith(false)

    el.dispatchEvent(new Event('pointerout', { bubbles: true }))
    expect(window.skyi.setPassthrough).toHaveBeenCalledWith(true)
  })
})

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AboutPage from '@/settings/AboutPage'

describe('AboutPage', () => {
  beforeEach(() => {
    vi.stubGlobal('lovelybuddy', {
      getAppInfo: vi.fn().mockResolvedValue({
        version: '0.1.0',
        electron: '31.0.0',
        chrome: '126.0.0',
        platform: 'darwin',
        arch: 'arm64',
        userData: '/Users/x/Library/Application Support/lovelybuddy'
      })
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('渲染品牌卡与真实运行信息', async () => {
    render(<AboutPage />)
    await waitFor(() => expect(screen.getByText(/lovely-buddy v0\.1\.0/)).toBeTruthy())
    expect(screen.getByText('macOS arm64')).toBeTruthy()
    expect(screen.getByText('pixi-live2d-display（Cubism Core）')).toBeTruthy()
    expect(screen.getByText('/Users/x/Library/Application Support/lovelybuddy')).toBeTruthy()
    expect(screen.getByText('Electron')).toBeTruthy()
    expect(screen.getByText('一只住在桌面角落的小猫，会看代码也会闲聊。')).toBeTruthy()
  })

  it('信息未返回前占位显示', () => {
    vi.stubGlobal('lovelybuddy', { getAppInfo: vi.fn().mockReturnValue(new Promise(() => {})) })
    render(<AboutPage />)
    expect(screen.getByText('lovely-buddy v0.1.0 · 本地运行')).toBeTruthy()
  })
})

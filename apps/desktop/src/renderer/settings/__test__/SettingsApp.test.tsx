import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsApp from '@/settings/SettingsApp'
import { useChatStore } from '@/store/chatStore'

const refreshMock = vi.fn()
const closeSettingsMock = vi.fn()

function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', {
    closeSettings: closeSettingsMock,
    notifyChatCleared: vi.fn(),
    onChatCleared: vi.fn(() => () => {}),
    exportFile: vi.fn().mockResolvedValue({ saved: false, path: null }),
    getRuntime: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:8740', token: 'dev', dev: true })
  })
}

describe('SettingsApp（独立设置窗口根组件）', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    closeSettingsMock.mockReset()
    useChatStore.setState({
      items: [],
      sending: false,
      error: null,
      refresh: refreshMock,
      clear: vi.fn()
    })
    mockLovelybuddy()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('挂载即拉取对话历史，渲染标题条与设置面板', async () => {
    render(<SettingsApp />)
    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
    expect(screen.getByText('设置')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '对话记录' })).toBeTruthy() // 页标题（导航按钮同名）
    expect(screen.getByTitle('关闭')).toBeTruthy()
  })

  it('Esc 与标题条关闭按钮走 closeSettings IPC', async () => {
    render(<SettingsApp />)
    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeSettingsMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTitle('关闭'))
    expect(closeSettingsMock).toHaveBeenCalledTimes(2)
  })
})

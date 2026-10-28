import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPanel from '@/settings/SettingsPanel'
import { useChatStore } from '@/store/chatStore'
import { useConnectionStore } from '@/store/connectionStore'

const clearMock = vi.fn()
const exportFileMock = vi.fn()
const notifyChatClearedMock = vi.fn()

function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', {
    exportFile: exportFileMock,
    notifyChatCleared: notifyChatClearedMock,
    getRuntime: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:8740', token: 'dev', dev: true }),
    getAppInfo: vi.fn().mockResolvedValue({
      version: '0.1.0',
      electron: '31.0.0',
      chrome: '126.0.0',
      platform: 'darwin',
      arch: 'arm64',
      userData: '/tmp/x'
    })
  })
}

beforeEach(() => {
  clearMock.mockReset().mockResolvedValue(undefined)
  exportFileMock.mockReset().mockResolvedValue({ saved: true, path: '/tmp/x.md' })
  notifyChatClearedMock.mockReset()
  useChatStore.setState({
    items: [
      { role: 'user', content: '嗨', created_at: new Date().toISOString() },
      { role: 'assistant', content: '早呀～', created_at: new Date().toISOString() }
    ],
    clear: clearMock
  })
  mockLovelybuddy()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SettingsPanel', () => {
  it('侧栏五入口全部可用，无外观与动作，对话记录默认选中', () => {
    render(<SettingsPanel />)
    for (const name of ['形象管理', '模型与连接', '对话记录', '角色设定', '关于']) {
      const btn = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(btn).toBeTruthy()
      expect(btn.disabled).toBe(false)
    }
    expect(screen.queryByRole('button', { name: '外观与动作' })).toBeNull()
    const active = screen.getByRole('button', { name: '对话记录' }) as HTMLButtonElement
    expect(active.className).toContain('active')
  })

  it('页头/会话卡与消息流渲染（桌宠奶油左、用户薄荷右）+ footer', () => {
    render(<SettingsPanel />)
    expect(screen.getByRole('heading', { name: '对话记录' })).toBeTruthy()
    expect(screen.getByText('共 2 条 · 仅存于本机')).toBeTruthy()
    // 会话卡标题 = 首条消息「嗨」；消息流里还有一条「嗨」
    expect(screen.getAllByText('嗨')).toHaveLength(2)
    expect(screen.getByText('早呀～')).toBeTruthy()
    expect(screen.getByText('仅保留最近 200 条 · 可导出为 Markdown')).toBeTruthy()
    expect(screen.getByText('早呀～').className).toContain('assistant')
    expect(screen.getByText('早呀～').className).toContain('bg-cream-deep')
  })

  it('点击「形象管理」切到模型页', () => {
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: '形象管理' }))
    expect(screen.getByRole('heading', { name: '形象管理' })).toBeTruthy()
  })

  it('点击「角色设定」切到角色设定页', () => {
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: '角色设定' }))
    expect(screen.getByRole('heading', { name: '角色设定' })).toBeTruthy()
  })

  it('点击「关于」切到关于页', () => {
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    expect(screen.getByRole('heading', { name: '关于' })).toBeTruthy()
  })

  it('点击「模型与连接」切到连接页', () => {
    useConnectionStore.setState({ config: { active_id: '', connections: [] } })
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: '模型与连接' }))
    expect(screen.getByRole('heading', { name: '模型与连接' })).toBeTruthy()
    expect(screen.getByText('尚未配置连接，添加后即可对话')).toBeTruthy()
  })

  it('搜索过滤消息流', () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByPlaceholderText('搜索记录'), { target: { value: '嗨' } })
    expect(screen.getAllByText('嗨').length).toBeGreaterThan(0) // 会话卡标题 + 消息
    expect(screen.queryByText('早呀～')).toBeNull()
  })

  it('无记录显示空态', () => {
    useChatStore.setState({ items: [] })
    render(<SettingsPanel />)
    expect(screen.getByText('暂无对话记录')).toBeTruthy()
  })

  it('清空：确认后调 chatStore.clear，成功后通知主进程广播（跨窗同步）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(confirmSpy).toHaveBeenCalledWith('清空全部对话记录？此操作不可恢复。')
    expect(clearMock).toHaveBeenCalled()
    await waitFor(() => expect(notifyChatClearedMock).toHaveBeenCalled())
  })

  it('清空：取消不调 clear', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(clearMock).not.toHaveBeenCalled()
  })

  it('清空失败（error 非空）不广播跨窗通知', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    clearMock.mockImplementation(async () => {
      useChatStore.setState({ error: '后端离线' })
    })
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    await waitFor(() => expect(useChatStore.getState().error).toBe('后端离线'))
    await act(async () => {}) // 冲掉 doClear 里 await clear() 的续体微任务
    expect(notifyChatClearedMock).not.toHaveBeenCalled()
  })

  it('导出：生成 Markdown 走 exportFile IPC，成功后按钮短暂变「已导出」', async () => {
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    await screen.findByText('已导出')
    expect(exportFileMock).toHaveBeenCalled()
    const [name, content] = exportFileMock.mock.calls[0] as [string, string]
    expect(name).toMatch(/^AI桌宠对话-\d{8}-\d{4}\.md$/)
    expect(content).toContain('# AI桌宠对话记录')
    expect(content).toContain('**我**：嗨')
    expect(content).toContain('**AI桌宠**：早呀～')
  })
})

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPanel from '../SettingsPanel'
import { useChatStore } from '../../../store/chatStore'

const clearMock = vi.fn()
const exportFileMock = vi.fn()
const notifyChatClearedMock = vi.fn()

function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', { exportFile: exportFileMock, notifyChatCleared: notifyChatClearedMock })
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SettingsPanel', () => {
  it('侧栏五入口渲染，仅「对话记录」可用且选中', () => {
    render(<SettingsPanel />)
    for (const name of ['形象管理', '模型与连接', '对话记录', '外观与动作', '关于']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    const active = screen.getByRole('button', { name: '对话记录' }) as HTMLButtonElement
    expect(active.className).toContain('active')
    expect(active.disabled).toBe(false)
    expect((screen.getByRole('button', { name: '形象管理' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('会话卡与消息流渲染（桌宠奶油左、用户薄荷右）+ footer', () => {
    render(<SettingsPanel />)
    expect(screen.getByText('AI桌宠对话')).toBeTruthy()
    expect(screen.getByText('嗨')).toBeTruthy()
    expect(screen.getByText('早呀～')).toBeTruthy()
    expect(screen.getByText('仅保留最近 200 条•可导出为 Markdown')).toBeTruthy()
    expect(screen.getByText('早呀～').className).toContain('assistant')
  })

  it('搜索过滤消息流', () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByPlaceholderText('搜索记录'), { target: { value: '嗨' } })
    expect(screen.getByText('嗨')).toBeTruthy()
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

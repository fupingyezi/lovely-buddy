import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectionPage from '@/settings/ConnectionPage'
import { useConnectionStore } from '@/store/connectionStore'
import type { ConfigState, ConnectionInfo } from '@/lib/configApi'

const conn = (over: Partial<ConnectionInfo>): ConnectionInfo => ({
  id: 'c1',
  provider: 'deepseek',
  base_url: '',
  model: 'deepseek-chat',
  max_tokens: 0,
  key_masked: 'sk-••••••••••••••••3f2a',
  has_key: true,
  last_check: new Date(Date.now() - 3 * 60_000).toISOString(),
  check_fail: false,
  active: true,
  ...over
})

const removeMock = vi.fn()
const testMock = vi.fn()
const addMock = vi.fn()
const updateMock = vi.fn()

function seed(cfg: ConfigState): void {
  useConnectionStore.setState({
    config: cfg,
    formOpen: false,
    editing: null,
    testing: false,
    testResult: null,
    error: null,
    remove: removeMock,
    test: testMock,
    add: addMock,
    update: updateMock
  })
}

beforeEach(() => {
  removeMock.mockReset()
  testMock.mockReset()
  addMock.mockReset()
  updateMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ConnectionPage', () => {
  it('页头 meta：当前模型 + 连接数', () => {
    seed({ active_id: 'c1', connections: [conn({}), conn({ id: 'c2', active: false })] })
    render(<ConnectionPage />)
    expect(screen.getByRole('heading', { name: '模型与连接' })).toBeTruthy()
    expect(screen.getByText('当前 deepseek-chat · 共 2 个连接')).toBeTruthy()
  })

  it('当前模型卡：服务商·模型 + 域名·校验时间 + 已连接', () => {
    seed({ active_id: 'c1', connections: [conn({})] })
    render(<ConnectionPage />)
    // 卡与行列表各显示一次名称，卡专属的 meta（校验时间）唯一
    expect(screen.getAllByText('DeepSeek · deepseek-chat').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('api.deepseek.com · 3 分钟前校验通过')).toBeTruthy()
    expect(screen.getByText('已连接')).toBeTruthy()
  })

  it('当前模型卡未校验态：灰点未连接 + 尚未校验', () => {
    seed({ active_id: 'c1', connections: [conn({ last_check: null })] })
    render(<ConnectionPage />)
    expect(screen.getByText('未连接')).toBeTruthy()
    expect(screen.getByText('api.deepseek.com · 尚未校验')).toBeTruthy()
  })

  it('无连接空态', () => {
    seed({ active_id: '', connections: [] })
    render(<ConnectionPage />)
    expect(screen.getByText('尚未配置连接，添加后即可对话')).toBeTruthy()
  })

  it('行三态：使用中徽章 / 未使用 / 未连接灰点', () => {
    seed({
      active_id: 'c1',
      connections: [
        conn({}),
        conn({ id: 'c2', active: false, check_fail: false, last_check: null }),
        conn({ id: 'c3', active: false, check_fail: true, model: 'qwen2.5', base_url: 'http://127.0.0.1:11434/v1' })
      ]
    })
    render(<ConnectionPage />)
    expect(screen.getByText('使用中')).toBeTruthy()
    expect(screen.getByText('未使用')).toBeTruthy()
    expect(screen.getByText('未连接')).toBeTruthy()
    expect(screen.getByText('127.0.0.1:11434 · 服务未启动')).toBeTruthy()
  })

  it('删除激活连接二次确认并调 remove；非激活直接删', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    seed({
      active_id: 'c1',
      connections: [conn({}), conn({ id: 'c2', active: false, provider: 'dashscope', model: 'qwen-plus' })]
    })
    render(<ConnectionPage />)
    const delBtns = screen.getAllByRole('button', { name: /删除连接/ })
    fireEvent.click(delBtns[0])
    expect(confirmSpy).toHaveBeenCalledWith('删除当前连接「DeepSeek」？聊天将回退到默认配置。此操作不可恢复。')
    fireEvent.click(delBtns[1])
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(removeMock).toHaveBeenCalledTimes(2))
  })

  it('添加连接按钮开表单，表单字段齐全，保存调用 add', async () => {
    seed({ active_id: '', connections: [] })
    useConnectionStore.setState({ openAdd: () => useConnectionStore.setState({ formOpen: true }) })
    render(<ConnectionPage />)
    fireEvent.click(screen.getByRole('button', { name: /添加连接/ }))
    expect(screen.getByLabelText('服务商')).toBeTruthy()
    expect(screen.getByLabelText('Base URL')).toBeTruthy()
    expect(screen.getByLabelText('API Key')).toBeTruthy()
    expect(screen.getByLabelText('模型名')).toBeTruthy()
    expect(screen.getByLabelText('最大 Token')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('模型名'), { target: { value: 'deepseek-reasoner' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并启用' }))
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'deepseek', model: 'deepseek-reasoner', api_key: '', max_tokens: 0 })
      )
    )
  })

  it('测试连接：按钮 loading 文案「测试中…」', () => {
    seed({ active_id: '', connections: [] })
    useConnectionStore.setState({
      openAdd: () => useConnectionStore.setState({ formOpen: true }),
      testing: true
    })
    render(<ConnectionPage />)
    fireEvent.click(screen.getByRole('button', { name: /添加连接/ }))
    expect(screen.getByRole('button', { name: '测试中…' })).toBeTruthy()
  })

  it('测试失败红字保留输入（字段值不变）', () => {
    seed({ active_id: '', connections: [] })
    useConnectionStore.setState({
      test: async () => {
        useConnectionStore.setState({ testResult: { ok: false, message: 'API Key 无效（401）' } })
      }
    })
    render(<ConnectionPage />)
    fireEvent.click(screen.getByRole('button', { name: /添加连接/ }))
    fireEvent.change(screen.getByLabelText('模型名'), { target: { value: 'gpt-4o-mini' } })
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    const result = screen.getByText('API Key 无效（401）')
    expect(result.className).toContain('text-accent-ink')
    expect((screen.getByLabelText('模型名') as HTMLInputElement).value).toBe('gpt-4o-mini')
  })

  it('点击行打开编辑表单：key 掩码 + 已保存 tag，保存走 update', async () => {
    seed({ active_id: 'c1', connections: [conn({})] })
    useConnectionStore.setState({
      openEdit: (c: ConnectionInfo) => useConnectionStore.setState({ formOpen: true, editing: c })
    })
    render(<ConnectionPage />)
    fireEvent.click(screen.getByText('使用中'))
    await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
    expect(screen.getByText('sk-••••••••••••••••3f2a')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存并启用' }))
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('c1', expect.objectContaining({ api_key: '' })))
  })

  it('编辑模式测试连接带上 id（后端按 id 回退存储 key）', async () => {
    seed({ active_id: 'c1', connections: [conn({})] })
    useConnectionStore.setState({
      openEdit: (c: ConnectionInfo) => useConnectionStore.setState({ formOpen: true, editing: c })
    })
    render(<ConnectionPage />)
    fireEvent.click(screen.getByText('使用中'))
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    await waitFor(() => expect(testMock).toHaveBeenCalledWith(expect.objectContaining({ api_key: '', id: 'c1' })))
  })
})

describe('转发表单', () => {
  const openForwardForm = (): void => {
    fireEvent.click(screen.getByText('添加连接'))
    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'forward' } })
  }

  it('选择自定义（转发）后隐藏四项输入，显示 JSON 框', () => {
    seed({ active_id: '', connections: [] })
    render(<ConnectionPage />)
    openForwardForm()
    expect(screen.getByLabelText('转发配置')).toBeTruthy()
    expect(screen.queryByLabelText('Base URL')).toBeNull()
    expect(screen.queryByLabelText('API Key')).toBeNull()
    expect(screen.queryByLabelText('模型名')).toBeNull()
    expect(screen.queryByLabelText('最大 Token')).toBeNull()
  })

  it('填入示例后保存：add 收到解析后的 forward 对象', () => {
    seed({ active_id: '', connections: [] })
    render(<ConnectionPage />)
    openForwardForm()
    fireEvent.click(screen.getByText('填入示例'))
    fireEvent.click(screen.getByText('保存并启用'))
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'forward',
        forward: expect.objectContaining({
          version: 1,
          request: expect.objectContaining({ url: 'http://127.0.0.1:3100/api/chat' })
        })
      })
    )
  })

  it('非法 JSON：红字带行号，保存与测试禁用', () => {
    seed({ active_id: '', connections: [] })
    render(<ConnectionPage />)
    openForwardForm()
    fireEvent.change(screen.getByLabelText('转发配置'), { target: { value: '{\n "request": {' } })
    expect(screen.getByText(/JSON 语法错误（第 2 行）/)).toBeTruthy()
    expect((screen.getByText('保存并启用').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('测试连接').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

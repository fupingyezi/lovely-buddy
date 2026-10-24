import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '../connectionStore'

// mock configApi：捕获调用参数，由测试驱动返回值
const fetchConfigMock = vi.fn()
const addConnectionMock = vi.fn()
const updateConnectionMock = vi.fn()
const deleteConnectionMock = vi.fn()
const testConnectionMock = vi.fn()
vi.mock('../../lib/configApi', () => ({
  fetchConfig: (...args: unknown[]) => fetchConfigMock(...args),
  addConnection: (...args: unknown[]) => addConnectionMock(...args),
  updateConnection: (...args: unknown[]) => updateConnectionMock(...args),
  deleteConnection: (...args: unknown[]) => deleteConnectionMock(...args),
  testConnection: (...args: unknown[]) => testConnectionMock(...args)
}))

const sampleState = {
  active_id: 'c1',
  connections: [
    {
      id: 'c1',
      provider: 'deepseek',
      base_url: '',
      model: 'deepseek-chat',
      max_tokens: 0,
      key_masked: 'sk-••••••••••••••••3f2a',
      has_key: true,
      last_check: null,
      check_fail: false,
      active: true
    }
  ]
}

beforeEach(() => {
  vi.stubGlobal('lovelybuddy', {
    getRuntime: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:8740', token: 'dev' })
  })
  fetchConfigMock.mockResolvedValue(sampleState)
  addConnectionMock.mockResolvedValue(sampleState)
  updateConnectionMock.mockResolvedValue(sampleState)
  deleteConnectionMock.mockResolvedValue(sampleState)
  testConnectionMock.mockResolvedValue({ ok: true, latency_ms: 12 })
  useConnectionStore.setState({
    config: null,
    error: null,
    formOpen: false,
    editing: null,
    testResult: null
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('connectionStore', () => {
  it('load 拉取配置', async () => {
    await useConnectionStore.getState().load()
    expect(useConnectionStore.getState().config?.connections).toHaveLength(1)
    expect(useConnectionStore.getState().loading).toBe(false)
  })

  it('add 成功：保存并关闭表单，tested/test_ok 跟随最近一次测试结果', async () => {
    await useConnectionStore
      .getState()
      .test({ provider: 'deepseek', base_url: '', model: 'm', api_key: 'k', max_tokens: 0 })
    await useConnectionStore
      .getState()
      .add({ provider: 'deepseek', base_url: '', model: 'm', api_key: 'k', max_tokens: 0 })
    const [, body] = addConnectionMock.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(body.tested).toBe(true)
    expect(body.test_ok).toBe(true)
    expect(useConnectionStore.getState().formOpen).toBe(false)
    expect(useConnectionStore.getState().testResult).toBeNull()
  })

  it('add 失败：错误透出且表单保持打开', async () => {
    addConnectionMock.mockRejectedValue(new Error('该连接已存在'))
    useConnectionStore.setState({ formOpen: true })
    await useConnectionStore
      .getState()
      .add({ provider: 'deepseek', base_url: '', model: 'm', api_key: 'k', max_tokens: 0 })
    expect(useConnectionStore.getState().error).toBe('该连接已存在')
    expect(useConnectionStore.getState().formOpen).toBe(true)
  })

  it('update 走 PUT（编辑模式），api_key 空 = 保留原 key', async () => {
    await useConnectionStore.getState().update('c1', {
      provider: 'deepseek',
      base_url: '',
      model: 'm2',
      api_key: '',
      max_tokens: 0
    })
    expect(updateConnectionMock).toHaveBeenCalledWith(expect.anything(), 'c1', expect.objectContaining({ api_key: '' }))
  })

  it('remove 调 deleteConnection 并更新 config', async () => {
    await useConnectionStore.getState().remove('c1')
    expect(deleteConnectionMock).toHaveBeenCalledWith(expect.anything(), 'c1')
    expect(useConnectionStore.getState().config?.active_id).toBe('c1')
  })

  it('openEdit/closeForm 状态流转', () => {
    useConnectionStore.getState().openEdit(sampleState.connections[0])
    expect(useConnectionStore.getState().editing?.id).toBe('c1')
    useConnectionStore.getState().closeForm()
    expect(useConnectionStore.getState().editing).toBeNull()
    expect(useConnectionStore.getState().formOpen).toBe(false)
  })

  it('test 失败：testResult 记红字文案', async () => {
    testConnectionMock.mockResolvedValue({ ok: false, error: 'API Key 无效（401）' })
    await useConnectionStore
      .getState()
      .test({ provider: 'deepseek', base_url: '', model: 'm', api_key: 'bad', max_tokens: 0 })
    expect(useConnectionStore.getState().testResult).toEqual({ ok: false, message: 'API Key 无效（401）' })
  })

  it('test 网络异常：兜底文案', async () => {
    testConnectionMock.mockRejectedValue(new Error('测试失败: HTTP 500'))
    await useConnectionStore
      .getState()
      .test({ provider: 'deepseek', base_url: '', model: 'm', api_key: 'k', max_tokens: 0 })
    expect(useConnectionStore.getState().testResult).toEqual({ ok: false, message: '测试失败: HTTP 500' })
  })
})

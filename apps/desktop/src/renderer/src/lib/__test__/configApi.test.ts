import { afterEach, describe, expect, it, vi } from 'vitest'
import { addConnection, deleteConnection, fetchConfig, testConnection, updateConnection } from '../configApi'
import type { ApiRuntime } from '../assetsApi'

const rt: ApiRuntime = { baseUrl: 'http://127.0.0.1:8740', token: 'dev' }

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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('configApi', () => {
  it('fetchConfig 带 Bearer token 并解析状态', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(sampleState), { status: 200 }))
    const st = await fetchConfig(rt)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8740/api/v1/config',
      expect.objectContaining({ headers: { Authorization: 'Bearer dev' } })
    )
    expect(st.connections[0].key_masked).toContain('••••')
  })

  it('addConnection 发送 JSON body', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(sampleState), { status: 200 }))
    await addConnection(rt, {
      provider: 'deepseek',
      model: 'm',
      api_key: 'k',
      base_url: '',
      max_tokens: 0,
      tested: true,
      test_ok: true
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      provider: 'deepseek',
      model: 'm',
      api_key: 'k',
      base_url: '',
      max_tokens: 0,
      tested: true,
      test_ok: true
    })
  })

  it('422 错误透出服务端中文文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: '该连接已存在' }), { status: 422 })
    )
    await expect(
      addConnection(rt, { provider: 'deepseek', model: 'm', api_key: '', base_url: '', max_tokens: 0 })
    ).rejects.toThrow('该连接已存在')
  })

  it('updateConnection PUT 到 /:id，deleteConnection DELETE /:id', async () => {
    // 每次调用新 Response 实例（body 只能读一次）
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 })))
    await updateConnection(rt, 'c1', { provider: 'deepseek', model: 'm2', api_key: '', base_url: '', max_tokens: 0 })
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/v1/config/connections/c1')
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('PUT')
    await deleteConnection(rt, 'c1')
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[1].method).toBe('DELETE')
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain('/api/v1/config/connections/c1')
  })

  it('testConnection 失败也正常返回 ok:false 不 throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'API Key 无效（401）' }), { status: 200 })
    )
    const res = await testConnection(rt, {
      provider: 'deepseek',
      model: 'm',
      api_key: 'bad',
      base_url: '',
      max_tokens: 0
    })
    expect(res).toEqual({ ok: false, error: 'API Key 无效（401）' })
  })
})

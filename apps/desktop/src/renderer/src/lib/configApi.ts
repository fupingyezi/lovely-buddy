// 模型与连接 API 客户端：与 Go 后端 /api/v1/config 通信（Bearer token）。
// 服务端永不回传 API Key 明文，只给掩码（key_masked）。
import type { ApiRuntime } from './assetsApi'

export interface ConnectionInfo {
  id: string
  provider: string
  base_url: string
  model: string
  max_tokens: number
  key_masked: string
  has_key: boolean
  last_check: string | null
  check_fail: boolean
  active: boolean
}

export interface ConfigState {
  active_id: string
  connections: ConnectionInfo[]
}

export interface ConnInput {
  provider: string
  base_url: string
  model: string
  api_key: string
  max_tokens: number
  /** 保存前执行过「测试连接」；test_ok = 其结果 */
  tested?: boolean
  test_ok?: boolean
}

export interface TestResult {
  ok: boolean
  error?: string
  latency_ms?: number
}

/** 测试连接请求（POST /api/v1/config/test）：id 可选，编辑模式下后端按 id 回退存储 key。 */
export interface TestInput {
  provider: string
  base_url: string
  model: string
  api_key: string
  max_tokens: number
  id?: string
}

function authHeaders(rt: ApiRuntime): Record<string, string> {
  return { Authorization: `Bearer ${rt.token}` }
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null
  return new Error(data?.error ?? fallback)
}

export async function fetchConfig(rt: ApiRuntime): Promise<ConfigState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config`, { headers: authHeaders(rt) })
  if (!res.ok) throw await parseError(res, `配置读取失败: HTTP ${res.status}`)
  return (await res.json()) as ConfigState
}

export async function addConnection(rt: ApiRuntime, input: ConnInput): Promise<ConfigState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config/connections`, {
    method: 'POST',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw await parseError(res, `保存失败: HTTP ${res.status}`)
  return (await res.json()) as ConfigState
}

export async function updateConnection(rt: ApiRuntime, id: string, input: ConnInput): Promise<ConfigState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config/connections/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw await parseError(res, `保存失败: HTTP ${res.status}`)
  return (await res.json()) as ConfigState
}

export async function deleteConnection(rt: ApiRuntime, id: string): Promise<ConfigState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(rt)
  })
  if (!res.ok) throw await parseError(res, `删除失败: HTTP ${res.status}`)
  return (await res.json()) as ConfigState
}

export async function testConnection(rt: ApiRuntime, input: TestInput): Promise<TestResult> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config/test`, {
    method: 'POST',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw await parseError(res, `测试失败: HTTP ${res.status}`)
  return (await res.json()) as TestResult
}

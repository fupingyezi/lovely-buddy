// 长期记忆 API 客户端：与 Go 后端 /api/v1/memories 通信（Bearer token）。
import type { ApiRuntime } from '@/lib/assetsApi'

export interface MemoryItem {
  id: number
  type: string
  content: string
  source: string
  created_at: string
}

export interface MemoryList {
  memories: MemoryItem[]
  total: number
  limit: number
}

function authHeaders(rt: ApiRuntime): Record<string, string> {
  return { Authorization: `Bearer ${rt.token}` }
}

export async function listMemories(rt: ApiRuntime, q: string): Promise<MemoryList> {
  const res = await fetch(`${rt.baseUrl}/api/v1/memories?q=${encodeURIComponent(q)}`, {
    headers: authHeaders(rt)
  })
  if (!res.ok) throw new Error(`记忆读取失败: HTTP ${res.status}`)
  return (await res.json()) as MemoryList
}

export async function addMemory(rt: ApiRuntime, type: string, content: string): Promise<MemoryItem> {
  const res = await fetch(`${rt.baseUrl}/api/v1/memories`, {
    method: 'POST',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, content })
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `记忆保存失败: HTTP ${res.status}`)
  }
  const data = (await res.json()) as { memory: MemoryItem }
  return data.memory
}

export async function deleteMemory(rt: ApiRuntime, id: number): Promise<void> {
  const res = await fetch(`${rt.baseUrl}/api/v1/memories/${id}`, {
    method: 'DELETE',
    headers: authHeaders(rt)
  })
  if (!res.ok) throw new Error(`记忆删除失败: HTTP ${res.status}`)
}

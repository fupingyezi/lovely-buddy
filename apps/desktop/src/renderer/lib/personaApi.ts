// 角色设定 API 客户端：与 Go 后端 /api/v1/persona 通信（Bearer token）。
import type { ApiRuntime } from '@/lib/assetsApi'

export interface PersonaState {
  text: string
  enabled: boolean
}

function authHeaders(rt: ApiRuntime): Record<string, string> {
  return { Authorization: `Bearer ${rt.token}` }
}

export async function getPersona(rt: ApiRuntime): Promise<PersonaState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/persona`, { headers: authHeaders(rt) })
  if (!res.ok) throw new Error(`人设读取失败: HTTP ${res.status}`)
  return (await res.json()) as PersonaState
}

export async function putPersona(rt: ApiRuntime, state: PersonaState): Promise<PersonaState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/persona`, {
    method: 'PUT',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `人设保存失败: HTTP ${res.status}`)
  }
  return (await res.json()) as PersonaState
}

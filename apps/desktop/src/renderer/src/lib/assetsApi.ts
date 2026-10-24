// 形象 API 客户端：与 Go 后端 /api/v1/assets 通信（Bearer token）。
// 服务端返回相对路径 entry，渲染端拼 l2d:// URL（Electron 特权协议，见 bridge/protocol.ts）。
export interface ApiRuntime {
  baseUrl: string
  token: string
}

export interface ImportSource {
  type: 'url' | 'path'
  value: string
}

interface RawAvatar {
  slug: string
  name: string
  kind: string
  entry: string
  author?: string
  version?: string
  license?: string
  homepage?: string
  persona?: string
  source?: string
  size_bytes?: number
  expressions?: number
}

function authHeaders(rt: ApiRuntime): Record<string, string> {
  return { Authorization: `Bearer ${rt.token}` }
}

function toAvatar(a: RawAvatar): AvatarInfo {
  return {
    slug: a.slug,
    name: a.name,
    url: `l2d://model/${a.entry}`,
    kind: a.kind === 'moc3' ? 'moc3' : 'moc',
    entry: a.entry,
    ...(a.author ? { author: a.author } : {}),
    ...(a.version ? { version: a.version } : {}),
    ...(a.license ? { license: a.license } : {}),
    ...(a.homepage ? { homepage: a.homepage } : {}),
    ...(a.source === 'local' || a.source === 'url' ? { source: a.source } : {}),
    ...(a.size_bytes !== undefined ? { sizeBytes: a.size_bytes } : {}),
    ...(a.expressions ? { expressions: a.expressions } : {})
  }
}

export async function listAvatars(rt: ApiRuntime): Promise<AvatarInfo[]> {
  const res = await fetch(`${rt.baseUrl}/api/v1/assets`, { headers: authHeaders(rt) })
  if (!res.ok) throw new Error(`形象列表失败: HTTP ${res.status}`)
  const data = (await res.json()) as { avatars: RawAvatar[] }
  return data.avatars.map(toAvatar)
}

export async function importAvatar(rt: ApiRuntime, source: ImportSource): Promise<AvatarInfo> {
  const res = await fetch(`${rt.baseUrl}/api/v1/assets/import`, {
    method: 'POST',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source })
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `导入失败: HTTP ${res.status}`)
  }
  const data = (await res.json()) as { avatar: RawAvatar }
  return toAvatar(data.avatar)
}

export async function deleteAvatar(rt: ApiRuntime, slug: string): Promise<void> {
  const res = await fetch(`${rt.baseUrl}/api/v1/assets/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: authHeaders(rt)
  })
  if (!res.ok) throw new Error(`删除失败: HTTP ${res.status}`)
}

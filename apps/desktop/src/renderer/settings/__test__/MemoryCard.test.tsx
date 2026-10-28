import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterPage from '@/settings/CharacterPage'
import { useMemoryStore } from '@/store/memoryStore'
import { usePersonaStore } from '@/store/personaStore'

const FIRST_CREATED_AT = '2026-10-27T10:00:00Z'

/** 本地时区 MM-DD：与页面展示同口径，避免断言随运行机器时区漂移 */
function localMonthDay(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', {
    getRuntime: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:8740', token: 'dev', dev: true })
  })
}

/** fetch 按 URL 路由到有状态的假后端（persona 静态、memories 可增删） */
function mockFetchApi(): void {
  let memories = [{ id: 1, type: '偏好', content: '喜欢喝拿铁', source: 'manual', created_at: FIRST_CREATED_AT }]
  let nextId = 2
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      if (url === 'http://127.0.0.1:8740/api/v1/persona' && method === 'GET') return json({ text: '', enabled: false })
      if (url.startsWith('http://127.0.0.1:8740/api/v1/memories?q=') && method === 'GET') {
        return json({ memories, total: memories.length, limit: 200 })
      }
      if (url === 'http://127.0.0.1:8740/api/v1/memories' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { type: string; content: string }
        const m = {
          id: nextId++,
          type: body.type,
          content: body.content.trim(),
          source: 'manual',
          created_at: '2026-10-28T10:00:00Z'
        }
        memories = [...memories, m]
        return json({ memory: m }, 201)
      }
      if (url.startsWith('http://127.0.0.1:8740/api/v1/memories/') && method === 'DELETE') {
        const id = Number(url.split('/').pop())
        memories = memories.filter((m) => m.id !== id)
        return json({ ok: true })
      }
      return json({}, 404)
    })
  )
}

describe('CharacterPage 记忆卡', () => {
  beforeEach(() => {
    mockLovelybuddy()
    mockFetchApi()
    useMemoryStore.setState({
      memories: [],
      total: 0,
      q: '',
      loading: true,
      adding: false,
      composerOpen: false,
      addType: '偏好',
      addText: '',
      error: null
    })
    usePersonaStore.setState({
      text: '',
      enabled: false,
      savedText: '',
      savedEnabled: false,
      loading: false,
      saving: false,
      error: null
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('载入列表：计数、行内容与 meta（手动添加 · 本地日期）', async () => {
    render(<CharacterPage />)
    await waitFor(() => expect(useMemoryStore.getState().loading).toBe(false))
    expect(screen.getByText('1 / 200')).toBeTruthy()
    expect(screen.getByText('喜欢喝拿铁')).toBeTruthy()
    expect(screen.getByText(`手动添加 · ${localMonthDay(FIRST_CREATED_AT)}`)).toBeTruthy()
  })

  it('新增：类型选择 + 输入 → 添加 → 列表刷新', async () => {
    render(<CharacterPage />)
    await waitFor(() => expect(useMemoryStore.getState().loading).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '新增' }))
    fireEvent.click(screen.getByText('事实'))
    fireEvent.change(screen.getByPlaceholderText('写下一条关于用户的记忆'), { target: { value: '养了一只猫' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(useMemoryStore.getState().total).toBe(2))
    expect(screen.getByText('养了一只猫')).toBeTruthy()
    expect(useMemoryStore.getState().composerOpen).toBe(false)
  })

  it('删除行后列表刷新', async () => {
    render(<CharacterPage />)
    await waitFor(() => expect(useMemoryStore.getState().loading).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '删除记忆 喜欢喝拿铁' }))
    await waitFor(() => expect(useMemoryStore.getState().total).toBe(0))
    expect(screen.queryByText('喜欢喝拿铁')).toBeNull()
  })
})

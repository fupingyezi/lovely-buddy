import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterPage from '@/settings/CharacterPage'
import { usePersonaStore } from '@/store/personaStore'

function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', {
    getRuntime: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:8740', token: 'dev', dev: true })
  })
}

function mockFetchApi(state: { text: string; enabled: boolean }): void {
  let saved = { ...state }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      if (url === 'http://127.0.0.1:8740/api/v1/persona' && method === 'GET') return json(saved)
      if (url === 'http://127.0.0.1:8740/api/v1/persona' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { text: string; enabled: boolean }
        saved = { text: body.text.trim(), enabled: body.enabled }
        return json(saved)
      }
      return json({}, 404)
    })
  )
}

describe('CharacterPage 人设卡', () => {
  beforeEach(() => {
    mockLovelybuddy()
    mockFetchApi({ text: '你是猫。', enabled: true })
    usePersonaStore.setState({
      text: '',
      enabled: false,
      savedText: '',
      savedEnabled: false,
      loading: true,
      saving: false,
      error: null
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('载入服务端人设并显示已注入 tag', async () => {
    render(<CharacterPage />)
    await waitFor(() => expect(screen.getByText('已注入')).toBeTruthy())
    expect((screen.getByRole('switch') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
  })

  it('编辑后保存 → PUT → 保存钮回到禁用', async () => {
    render(<CharacterPage />)
    await waitFor(() => expect(usePersonaStore.getState().loading).toBe(false))
    const ta = screen.getByPlaceholderText('写下它该有的样子，例如性格、说话习惯、偏好……')
    fireEvent.change(ta, { target: { value: '你是一只狗。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(usePersonaStore.getState().saving).toBe(false))
    expect(usePersonaStore.getState().savedText).toBe('你是一只狗。')
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('保存飞行中继续输入：响应不覆盖新内容，dirty 保留且二次保存发送新内容', async () => {
    let resolvePut!: (r: Response) => void
    const putBodies: string[] = []
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url === 'http://127.0.0.1:8740/api/v1/persona' && method === 'GET') {
          return Promise.resolve(json({ text: '你是猫。', enabled: true }))
        }
        if (url === 'http://127.0.0.1:8740/api/v1/persona' && method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as { text: string; enabled: boolean }
          putBodies.push(body.text)
          if (putBodies.length === 1) {
            return new Promise<Response>((resolve) => {
              resolvePut = resolve
            })
          }
          return Promise.resolve(json({ text: body.text.trim(), enabled: body.enabled }))
        }
        return Promise.resolve(json({}, 404))
      })
    )

    render(<CharacterPage />)
    await waitFor(() => expect(usePersonaStore.getState().loading).toBe(false))
    const ta = screen.getByPlaceholderText('写下它该有的样子，例如性格、说话习惯、偏好……') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(putBodies).toEqual(['A']))
    fireEvent.change(ta, { target: { value: 'B' } })
    resolvePut(json({ text: 'A', enabled: true }))
    await waitFor(() => expect(usePersonaStore.getState().saving).toBe(false))
    expect(usePersonaStore.getState().text).toBe('B')
    expect(usePersonaStore.getState().savedText).toBe('A')
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(usePersonaStore.getState().savedText).toBe('B'))
    expect(putBodies).toEqual(['A', 'B'])
    expect(usePersonaStore.getState().text).toBe('B')
  })

  it('chips 插入光标处', async () => {
    render(<CharacterPage />)
    await waitFor(() => expect(usePersonaStore.getState().loading).toBe(false))
    const ta = screen.getByPlaceholderText('写下它该有的样子，例如性格、说话习惯、偏好……') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '你好' } })
    ta.setSelectionRange(2, 2)
    fireEvent.click(screen.getByText('{user_name}'))
    expect(usePersonaStore.getState().text).toBe('你好{user_name}')
  })
})

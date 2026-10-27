import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ModelPage from '@/settings/ModelPage'
import { usePetStore } from '@/store/petStore'

const notifyMock = vi.fn()
const pickMock = vi.fn()
const pathForFileMock = vi.fn()

function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', {
    getRuntime: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:8740', token: 'dev', dev: true }),
    notifyModelsChanged: notifyMock,
    pickImportPath: pickMock,
    getPathForFile: pathForFileMock
  })
}

/** fetch 按 URL 路由到有状态的假后端（store 内为 camelCase AvatarInfo，API 响应转 snake_case） */
function mockFetchApi(avatars: Array<Record<string, unknown>>): void {
  let list: Array<Record<string, unknown>> = [...avatars]
  const raw = (a: Record<string, unknown>): Record<string, unknown> => ({
    slug: a.slug,
    name: a.name,
    kind: a.kind,
    entry: a.entry,
    size_bytes: a.sizeBytes,
    expressions: a.expressions
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      if (url === 'http://127.0.0.1:8740/api/v1/assets' && method === 'GET') return json({ avatars: list.map(raw) })
      if (url === 'http://127.0.0.1:8740/api/v1/assets/import' && method === 'POST') {
        const avatar = list[0]
        return json({ avatar: raw(avatar) })
      }
      if (url.startsWith('http://127.0.0.1:8740/api/v1/assets/') && method === 'DELETE') {
        const slug = decodeURIComponent(url.split('/').pop() ?? '')
        list = list.filter((a) => a.slug !== slug)
        return json({ ok: true })
      }
      return json({}, 404)
    })
  )
}

const haru = {
  slug: 'haru',
  name: 'haru-cubism4',
  url: 'l2d://model/haru/haru.model3.json',
  kind: 'moc3',
  entry: 'haru/haru.model3.json',
  sizeBytes: 4404019,
  expressions: 2
}
const shizuku = {
  slug: 'shizuku',
  name: 'shizuku-cubism2',
  url: 'l2d://model/shizuku/shizuku.model.json',
  kind: 'moc',
  entry: 'shizuku/shizuku.model.json',
  sizeBytes: 10485760,
  expressions: 0
}

function setStore(extra: Partial<ReturnType<typeof usePetStore.getState>> = {}): void {
  usePetStore.setState({
    models: [haru, shizuku] as never,
    modelUrl: haru.url,
    modelName: haru.name,
    modelError: null,
    placeholderDismissed: false,
    importing: false,
    importError: null,
    importName: null,
    status: 'online',
    version: null,
    ...extra
  })
}

describe('ModelPage', () => {
  beforeEach(() => {
    localStorage.clear()
    notifyMock.mockReset()
    pickMock.mockReset()
    pathForFileMock.mockReset()
    setStore()
    mockLovelybuddy()
    mockFetchApi([haru, shizuku])
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('页头 meta 与行元信息（体积/表情）', () => {
    render(<ModelPage />)
    expect(screen.getByText(/共 2 个 · 占用 14\.2 MB · Cubism 3 \/ 4/)).toBeTruthy()
    expect(screen.getByText('haru.model3 · 4.2 MB · 2 组表情')).toBeTruthy()
    expect(screen.getByText('shizuku.model · 10.0 MB')).toBeTruthy()
    expect(screen.getByText('使用中')).toBeTruthy()
  })

  it('点击非当前行切换形象', () => {
    render(<ModelPage />)
    fireEvent.click(screen.getByText('shizuku-cubism2'))
    expect(usePetStore.getState().modelUrl).toBe(shizuku.url)
  })

  it('删除当前形象：二次确认（提示回退）→ DELETE → 广播', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ModelPage />)
    fireEvent.click(screen.getByRole('button', { name: '删除形象 haru-cubism4' }))
    expect(window.confirm).toHaveBeenCalledWith('删除当前形象「haru-cubism4」？将回退到默认形象。此操作不可恢复。')
    await waitFor(() => expect(usePetStore.getState().models.map((m) => m.slug)).toEqual(['shizuku']))
    expect(notifyMock).toHaveBeenCalled()
  })

  it('删除取消不调 API', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ModelPage />)
    fireEvent.click(screen.getByRole('button', { name: '删除形象 haru-cubism4' }))
    expect(usePetStore.getState().models).toHaveLength(2)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('导入中：转圈 + 导入中徽章（无取消钮）', () => {
    setStore({ importing: true, importName: 'hiyori' })
    render(<ModelPage />)
    expect(screen.getByText('正在导入 hiyori')).toBeTruthy()
    expect(screen.getByText('导入中')).toBeTruthy()
    expect(screen.queryByText('取消')).toBeNull()
  })

  it('导入失败：失败行展示源名与错误，移除清除', () => {
    setStore({ importError: '不是 Cubism 3/4 模型文件', importName: 'evil.zip' })
    render(<ModelPage />)
    expect(screen.getByText('evil.zip')).toBeTruthy()
    expect(screen.getByText('不是 Cubism 3/4 模型文件')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
    fireEvent.click(screen.getByText('移除'))
    expect(usePetStore.getState().importError).toBeNull()
    expect(usePetStore.getState().importName).toBeNull()
  })

  it('浏览导入：pickImportPath(dir) → POST 导入 → 广播', async () => {
    pickMock.mockResolvedValue({ canceled: false, path: '/tmp/hiyori' })
    render(<ModelPage />)
    fireEvent.click(screen.getByRole('button', { name: '导入模型' }))
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(pickMock).toHaveBeenCalledWith('dir')
  })

  it('拖放导入：getPathForFile 解析绝对路径 → 导入', async () => {
    pathForFileMock.mockReturnValue('/tmp/hiyori')
    render(<ModelPage />)
    const zone = screen.getByText('拖入 .model3.json 所在文件夹，或点击浏览').closest('div') as HTMLElement
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'hiyori.model3.json')] } })
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(pathForFileMock).toHaveBeenCalled()
  })
})

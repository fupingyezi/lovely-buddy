import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.moc': 'application/octet-stream',
  '.moc3': 'application/octet-stream',
  '.mtn': 'application/octet-stream'
}

// 注册必须在 app.ready 之前调用
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'l2d',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

/**
 * l2d://model/<相对路径> → 模型根目录文件。
 * 渲染页 Origin 与 l2d 不同源，响应必须带 ACAO 供 fetch/XHR 读取；
 * 路径经 resolve 后校验仍在根目录内，防 .. 穿越。
 */
export function registerL2DProtocol(getModelRoot: () => string): void {
  protocol.handle('l2d', async (request) => {
    const root = getModelRoot()
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const target = resolve(root, rel)
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    try {
      const data = await readFile(target)
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

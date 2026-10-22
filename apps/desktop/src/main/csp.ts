import { app, session } from 'electron'

// CSP 以响应头注入（不用 index.html meta）：dev 需要放行 Vite HMR 的内联脚本，打包后收紧。
export function setupCSP(): void {
  const dev = !app.isPackaged
  const scriptSrc = dev ? "'self' 'unsafe-inline'" : "'self'"
  const connectSrc = [
    "'self'",
    'http://127.0.0.1:*',
    'ws://127.0.0.1:*',
    'l2d:',
    ...(dev ? ['http://localhost:5173', 'ws://localhost:5173'] : [])
  ].join(' ')
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' l2d: data: blob:",
    `connect-src ${connectSrc}`,
    "media-src 'self' l2d:", // 模型动作自带音效（v1 无 TTS，音效走 l2d://）
    "font-src 'self' data:"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

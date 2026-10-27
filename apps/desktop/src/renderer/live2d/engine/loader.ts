// Cubism core 是 UMD 全局脚本，不进 Vite 打包；用动态 <script> 注入，
// new URL(rel, document.baseURI) 在 dev(5173) 与打包后 file:// 下都能解析到 public/live2d/。
let coresPromise: Promise<void> | null = null

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Cubism core 加载失败: ${src}`))
    document.head.appendChild(s)
  })
}

/** 幂等加载两个 core（Cubism 4 的 .moc3 + Cubism 2.1 的 .moc），首次调用时注入。 */
export function loadCubismCores(): Promise<void> {
  coresPromise ??= (async () => {
    await injectScript(new URL('live2d/live2dcubismcore.min.js', document.baseURI).href)
    await injectScript(new URL('live2d/live2d.min.js', document.baseURI).href)
    if (typeof window.Live2DCubismCore === 'undefined' || typeof window.Live2D === 'undefined') {
      throw new Error('Cubism core 未就绪：请先运行 scripts/fetch-assets.sh')
    }
  })()
  return coresPromise
}

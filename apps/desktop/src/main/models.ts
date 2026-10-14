import { existsSync, readdirSync, type Dirent } from 'node:fs'
import { basename, join, relative } from 'node:path'

export interface ModelInfo {
  name: string
  url: string
  kind: 'moc' | 'moc3'
}

/** 递归扫描模型根目录，收集 *.model3.json（Cubism 4+）与 *.model.json（Cubism 2）。 */
export function listModels(root: string): ModelInfo[] {
  if (!root || !existsSync(root)) return []
  const out: ModelInfo[] = []

  const walk = (dir: string, depth: number): void => {
    if (depth > 3 || out.length > 100) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p, depth + 1)
        continue
      }
      const rel = relative(root, p).split('\\').join('/')
      if (e.name.endsWith('.model3.json')) {
        out.push({ name: basename(dir), url: `l2d://model/${rel}`, kind: 'moc3' })
      } else if (e.name.endsWith('.model.json')) {
        out.push({ name: basename(dir), url: `l2d://model/${rel}`, kind: 'moc' })
      }
    }
  }

  walk(root, 0)
  return out
}

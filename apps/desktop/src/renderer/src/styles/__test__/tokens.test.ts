import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 注意：不能写 new URL('../tokens.css', import.meta.url)——Vite 会静态改写该表达式（?raw 也会因 css:false 返回空串）。
// 用裸 import.meta.url + fileURLToPath 手工解析，路径不受构建转换影响。
const stylesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function cssOf(name: 'tokens' | 'index'): string {
  return readFileSync(resolve(stylesDir, `${name}.css`), 'utf-8')
}

function varValue(css: string, name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`token --${name} 未找到`)
  return m[1].trim()
}

// 设计 token 契约（design-v1/README.md「设计 token」+ 图 04，值即线上规范）
const TOKENS: Record<string, string> = {
  'color-primary': '#5bc8a6',
  'color-primary-deep': '#35a483',
  'color-primary-press': '#54b899',
  'color-accent': '#ffb9c7',
  'color-accent-ink': '#e36f8c',
  'color-bg': '#fbf7f0',
  'color-surface': '#ffffff',
  'color-ink': '#33403b',
  'color-ink-2': '#7c8c86',
  'color-ink-3': '#a6b3ad',
  'color-border': '#efe8de',
  'radius-card': '28px',
  'radius-panel': '24px',
  'radius-bubble': '26px',
  'radius-input': '20px',
  'radius-msg': '16px',
  'radius-pill': '999px',
  'fs-title': '19px',
  'fs-body': '13px',
  'fs-aux': '11px'
}

describe('设计 token 契约', () => {
  it('色板/圆角/字号与 design-v1 规范一致', () => {
    const css = cssOf('tokens')
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(varValue(css, name), `--${name}`).toBe(value)
    }
  })

  it('投影与描边 token 与规范一致', () => {
    const css = cssOf('tokens')
    expect(varValue(css, 'shadow-mint')).toBe('0 12px 32px -6px rgba(91, 200, 166, 0.12)')
    expect(varValue(css, 'shadow-mint-deep')).toBe('0 14px 36px -6px rgba(91, 200, 166, 0.2)')
  })

  it('间距 token 取 4 的倍数（8/12/14/18/24）', () => {
    const css = cssOf('tokens')
    expect(['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5'].map((n) => varValue(css, n.slice(2)))).toEqual([
      '8px',
      '12px',
      '14px',
      '18px',
      '24px'
    ])
  })
})

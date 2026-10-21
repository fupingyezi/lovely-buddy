// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listModels } from '../models'

const tempDirs: string[] = []

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lovelybuddy-models-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('listModels', () => {
  it('目录不存在时返回空列表', () => {
    expect(listModels(join(tmpdir(), 'lovelybuddy-no-such-dir'))).toEqual([])
  })

  it('递归发现 .model3.json 与 .model.json，名称为所在目录', () => {
    const root = makeTempRoot()
    mkdirSync(join(root, 'haru'), { recursive: true })
    mkdirSync(join(root, 'nested', 'shizuku'), { recursive: true })
    writeFileSync(join(root, 'haru', 'haru.model3.json'), '{}')
    writeFileSync(join(root, 'nested', 'shizuku', 'shizuku.model.json'), '{}')

    expect(listModels(root)).toEqual([
      { name: 'haru', url: 'l2d://model/haru/haru.model3.json', kind: 'moc3' },
      { name: 'shizuku', url: 'l2d://model/nested/shizuku/shizuku.model.json', kind: 'moc' }
    ])
  })

  it('超过 4 层深度不扫描', () => {
    const root = makeTempRoot()
    const deep = join(root, 'd1', 'd2', 'd3', 'd4')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'x.model3.json'), '{}')
    expect(listModels(root)).toEqual([])
  })

  it('跳过隐藏目录', () => {
    const root = makeTempRoot()
    mkdirSync(join(root, '.hidden'), { recursive: true })
    writeFileSync(join(root, '.hidden', 'x.model.json'), '{}')
    expect(listModels(root)).toEqual([])
  })
})

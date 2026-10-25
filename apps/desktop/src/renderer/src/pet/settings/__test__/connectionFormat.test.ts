import { describe, expect, it } from 'vitest'
import { hostOf, modelLabel, providerLabel, relTime } from '../connectionFormat'

const base = {
  max_tokens: 0,
  key_masked: '',
  has_key: false,
  last_check: null,
  check_fail: false,
  active: false
}

describe('connectionFormat', () => {
  it('relTime 相对时间', () => {
    expect(relTime(null)).toBe('尚未校验')
    const now = Date.now()
    expect(relTime(new Date(now - 30_000).toISOString())).toBe('刚刚校验通过')
    expect(relTime(new Date(now - 3 * 60_000).toISOString())).toBe('3 分钟前校验通过')
  })

  it('relTime 跨天显示日期', () => {
    const yesterday = new Date(Date.now() - 24 * 3600_000)
    const got = relTime(yesterday.toISOString())
    expect(got).toContain('校验通过')
    expect(got).not.toContain('分钟前')
  })

  it('providerLabel 映射与未知兜底', () => {
    expect(providerLabel('deepseek')).toBe('DeepSeek')
    expect(providerLabel('dashscope')).toBe('阿里云百炼')
    expect(providerLabel('zhipu')).toBe('智谱 AI')
    expect(providerLabel('moonshot')).toBe('月之暗面 Kimi')
    expect(providerLabel('unknown')).toBe('unknown')
  })

  it('hostOf：base_url 优先，空用厂商默认域名', () => {
    expect(
      hostOf({ ...base, id: 'x', provider: 'deepseek', base_url: 'https://api.deepseek.com/v1', model: 'm' })
    ).toBe('api.deepseek.com')
    expect(hostOf({ ...base, id: 'x', provider: 'moonshot', base_url: '', model: 'm' })).toBe('api.moonshot.cn')
    expect(hostOf({ ...base, id: 'x', provider: 'deepseek', base_url: 'http://127.0.0.1:11434/v1', model: 'm' })).toBe(
      '127.0.0.1:11434'
    )
  })

  it('forward 显示名 / modelLabel / hostOf 取 request.url', () => {
    expect(providerLabel('forward')).toBe('自定义（转发）')
    expect(modelLabel({ ...base, id: 'x', provider: 'forward', base_url: '', model: '' })).toBe('转发')
    expect(
      hostOf({
        ...base,
        id: 'x',
        provider: 'forward',
        base_url: '',
        model: '',
        forward: { request: { url: 'http://127.0.0.1:3100/api/chat' } }
      })
    ).toBe('127.0.0.1:3100')
  })
})

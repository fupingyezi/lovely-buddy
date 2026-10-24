// 模型与连接页纯展示换算：相对校验时间 / 厂商显示名 / 域名。与后端 registry 的默认地址镜像。
import type { ConnectionInfo } from '../../lib/configApi'

export const PROVIDER_LABEL: Record<string, string> = {
  deepseek: 'DeepSeek',
  dashscope: '阿里云百炼',
  zhipu: '智谱 AI',
  moonshot: '月之暗面 Kimi'
}

const PROVIDER_DEFAULT_URL: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  moonshot: 'https://api.moonshot.cn/v1'
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}

/** base_url → host；空用厂商默认域名（与 Go llm.Providers 镜像）。 */
export function hostOf(c: ConnectionInfo): string {
  const raw = c.base_url || PROVIDER_DEFAULT_URL[c.provider] || ''
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
}

/** 最近校验时间 → 设计图文案：刚刚/N 分钟前校验通过、今天 HH:mm 校验通过、M月D日 HH:mm 校验通过。 */
export function relTime(t: string | null): string {
  if (!t) return '尚未校验'
  const d = new Date(t)
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return '刚刚校验通过'
  if (mins < 60) return `${mins} 分钟前校验通过`
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? `今天 ${hm} 校验通过` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm} 校验通过`
}

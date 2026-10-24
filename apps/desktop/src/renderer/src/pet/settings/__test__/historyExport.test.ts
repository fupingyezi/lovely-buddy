import { describe, expect, it } from 'vitest'
import { exportFileName, filterChatItems, groupByDay, historyToMarkdown, sessionSubtitle } from '../historyExport'
import type { ChatItem } from '../../../store/chatStore'

// 固定「现在」避免时区/日期漂移：2026-10-24 周五 10:30 本地
const NOW = new Date(2026, 9, 24, 10, 30)

const items: ChatItem[] = [
  { role: 'user', content: '嗨', created_at: '2026-10-24T10:24:00' },
  { role: 'assistant', content: '早呀～', created_at: '2026-10-24T10:24:01' },
  { role: 'user', content: '昨天的问题', created_at: '2026-10-23T21:10:00' },
  { role: 'assistant', content: '修好了', created_at: '2026-10-23T21:10:05' },
  { role: 'user', content: '更早', created_at: '2026-10-20T09:00:00' },
  { role: 'assistant', content: '收到', created_at: '2026-10-20T09:00:02' }
]

describe('groupByDay', () => {
  it('按本地日分组，标签为 今天/昨天/M月D日', () => {
    const groups = groupByDay(items, NOW)
    expect(groups.map((g) => g.label)).toEqual(['今天', '昨天', '10月20日'])
    expect(groups[0]?.items.map((i) => i.content)).toEqual(['嗨', '早呀～'])
    expect(groups[2]?.items).toHaveLength(2)
  })

  it('无 created_at 的消息归入今天', () => {
    const groups = groupByDay([{ role: 'user', content: '本地新发' }], NOW)
    expect(groups[0]?.label).toBe('今天')
  })
})

describe('filterChatItems', () => {
  it('大小写不敏感子串过滤，空串原样返回', () => {
    expect(filterChatItems(items, '问题')).toHaveLength(1)
    expect(filterChatItems(items, '  ')).toBe(items)
    expect(filterChatItems([{ role: 'user', content: 'Hello' }], 'hello')).toHaveLength(1)
  })
})

describe('sessionSubtitle', () => {
  it('格式为「今天 10:24•N条」（取末条消息的日期时间）', () => {
    expect(sessionSubtitle(items.slice(0, 2), NOW)).toBe('今天 10:24•2条')
    expect(sessionSubtitle(items, NOW)).toBe('10月20日 09:00•6条')
  })

  it('无记录显示「暂无记录」', () => {
    expect(sessionSubtitle([], NOW)).toBe('暂无记录')
  })
})

describe('historyToMarkdown', () => {
  it('按天分组导出，user→我、assistant→AI桌宠', () => {
    const md = historyToMarkdown(items)
    expect(md).toContain('# AI桌宠对话记录')
    expect(md).toContain('## 今天')
    expect(md).toContain('**我**：嗨')
    expect(md).toContain('**AI桌宠**：早呀～')
    expect(md).toContain('## 昨天')
    expect(md).toContain('## 10月20日')
  })

  it('空记录只有标题与导出时间', () => {
    const md = historyToMarkdown([])
    expect(md).toContain('# AI桌宠对话记录')
    expect(md).toContain('> 导出时间：')
    expect(md).not.toContain('**我**')
  })
})

describe('exportFileName', () => {
  it('形如 AI桌宠对话-20261024-1030.md', () => {
    expect(exportFileName(NOW)).toBe('AI桌宠对话-20261024-1030.md')
  })
})

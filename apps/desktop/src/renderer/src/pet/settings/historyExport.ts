import type { ChatItem } from '../../store/chatStore'

export interface HistoryGroup {
  label: string
  items: ChatItem[]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parse(item: ChatItem): Date {
  return item.created_at ? new Date(item.created_at) : new Date()
}

/** 「今天/昨天/M月D日」标签（会话卡与消息流分组共用） */
function dayLabel(isoLike: string | undefined, now: Date): string {
  const d = isoLike ? new Date(isoLike) : now
  const day = localDay(d)
  if (day === localDay(now)) return '今天'
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (day === localDay(yesterday)) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 消息流分组：按本地日分组，标签今天/昨天/M月D日；无 created_at（本地新发）归今天 */
export function groupByDay(items: ChatItem[], now: Date = new Date()): HistoryGroup[] {
  const groups: HistoryGroup[] = []
  for (const it of items) {
    const label = dayLabel(it.created_at, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(it)
    else groups.push({ label, items: [it] })
  }
  return groups
}

/** 搜索过滤：内容大小写不敏感子串；空查询原样返回 */
export function filterChatItems(items: ChatItem[], query: string): ChatItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((it) => it.content.toLowerCase().includes(q))
}

/** 会话卡副标题：`今天 10:24•6条`；无记录「暂无记录」 */
export function sessionSubtitle(items: ChatItem[], now: Date = new Date()): string {
  if (items.length === 0) return '暂无记录'
  const last = parse(items[items.length - 1])
  return `${dayLabel(items[items.length - 1].created_at, now)} ${pad(last.getHours())}:${pad(last.getMinutes())}•${items.length}条`
}

/** 导出文件名：AI桌宠对话-YYYYMMDD-HHmm.md */
export function exportFileName(d: Date): string {
  return `AI桌宠对话-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`
}

/** 对话记录 → Markdown（图 03 footer「可导出为 Markdown」） */
export function historyToMarkdown(items: ChatItem[]): string {
  const lines = ['# AI桌宠对话记录', '']
  const d = new Date()
  lines.push(
    `> 导出时间：${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
  for (const g of groupByDay(items)) {
    lines.push('', `## ${g.label}`)
    for (const it of g.items) {
      lines.push('', `**${it.role === 'user' ? '我' : 'AI桌宠'}**：${it.content}`)
    }
  }
  return lines.join('\n') + '\n'
}

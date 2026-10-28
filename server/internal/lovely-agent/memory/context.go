package memory

import "strings"

// BuildSegment 记忆段文案（上下文固定顺序的「检索记忆」段，插在历史之后、最新输入之前）。
// 空列表返回 ""（调用方不追加消息）。输出形态：
//
//	关于用户的长期记忆：
//	- [偏好] 喜欢喝拿铁
//	- [事实] 养了一只猫
func BuildSegment(items []Item) string {
	if len(items) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("关于用户的长期记忆：\n")
	for _, it := range items {
		b.WriteString("- [")
		b.WriteString(it.Type)
		b.WriteString("] ")
		b.WriteString(it.Content)
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

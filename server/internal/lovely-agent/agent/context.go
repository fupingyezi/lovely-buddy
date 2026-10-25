package agent

import (
	"context"

	"lovelybuddy/server/internal/lovely-agent/model"
)

// ContextConfig 上下文构建的注入源，wiring 唯一归 service（harness 设计 §2.1）。
// 记忆检索与技能指令是后续功能的注入位（设计 §4.1：稳定前缀 → 历史 → 技能指令 → 检索记忆 → 最新输入），
// 本版本只实现 system → 历史 → 最新输入三段。
type ContextConfig struct {
	// SystemPrompt 人设+动作协议文案（桌宠专属，service 注入；入参为形象人设文本）。
	SystemPrompt func(persona string) string
	// PersonaLoader 取形象人设文本（avatar.json.persona）；(text, false) = 无。
	PersonaLoader func(avatarSlug string) (string, bool)
	// History 本次对话历史（不含最新输入）。service 在落用户消息前已读好并捕获——
	// 落库先行（记录语义），上下文构建不接触 store。
	History func() []model.Message
	// HistoryLimit 历史裁剪条数（0 = 不裁剪）。
	HistoryLimit int
}

// Build 按固定顺序组装请求：system（人设+动作协议）→ 历史 → 最新输入（裁最旧）。
func Build(ctx context.Context, cc ContextConfig, avatarSlug, userText string) []model.Message {
	history := cc.History()
	if cc.HistoryLimit > 0 && len(history) > cc.HistoryLimit {
		history = history[len(history)-cc.HistoryLimit:]
	}
	persona, _ := cc.PersonaLoader(avatarSlug)
	msgs := make([]model.Message, 0, len(history)+2)
	msgs = append(msgs, model.Message{Role: "system", Content: cc.SystemPrompt(persona)})
	msgs = append(msgs, history...)
	msgs = append(msgs, model.Message{Role: "user", Content: userText})
	return msgs
}

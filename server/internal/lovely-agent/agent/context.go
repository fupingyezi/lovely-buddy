package agent

import (
	"context"

	"lovelybuddy/server/internal/lovely-agent/model"
)

// ContextConfig 上下文构建的注入源，wiring 唯一归 service。
// 组装顺序固定：稳定前缀（人设+动作协议）→ 历史 → 检索记忆 → 最新输入；
// 技能指令是后续功能的注入位。
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
	// Memory 记忆段文案（service 注入；按最新用户输入构建，空串 = 无记忆段）。
	// 本版本为全量注入；M5 换语义检索，注入位与接口不变。
	Memory func(userText string) string
}

// Build 按固定顺序组装请求：system（人设+动作协议）→ 历史 → 检索记忆 → 最新输入（裁最旧）。
func Build(ctx context.Context, cc ContextConfig, avatarSlug, userText string) []model.Message {
	history := cc.History()
	if cc.HistoryLimit > 0 && len(history) > cc.HistoryLimit {
		history = history[len(history)-cc.HistoryLimit:]
	}
	persona, _ := cc.PersonaLoader(avatarSlug)
	msgs := make([]model.Message, 0, len(history)+3)
	msgs = append(msgs, model.Message{Role: "system", Content: cc.SystemPrompt(persona)})
	msgs = append(msgs, history...)
	if cc.Memory != nil {
		if seg := cc.Memory(userText); seg != "" {
			msgs = append(msgs, model.Message{Role: "system", Content: seg})
		}
	}
	msgs = append(msgs, model.Message{Role: "user", Content: userText})
	return msgs
}

package service

// 人设与动作协议文案（桌宠专属）：经 agent.ContextConfig.SystemPrompt 注入 harness。

import (
	"fmt"
	"strings"
)

const defaultPersona = "你是用户的桌面宠物，性格活泼友善，喜欢陪伴用户。"

// SystemPrompt 人设 + 动作协议（稳定前缀放最前，缓存友好——只有换人设才失效）。
// 动作意图集合与 renderer live2d/motionMap.ts 的 MotionIntent 保持一致。
func SystemPrompt(persona string) string {
	if strings.TrimSpace(persona) == "" {
		persona = defaultPersona
	}
	return fmt.Sprintf(`%s

回复规则：
- 用中文口语化聊天，一般不超过两句话，不说套话。
- 想做动作时在回复里嵌入恰好一个动作标签，格式 [motion:意图]，意图只能是：idle、tap、greet、thinking、speak、happy、sad、angry、surprised、bye、sleep。标签会被剥离后播放，不要解释它。
- 不使用 markdown、列表或代码块。`, persona)
}

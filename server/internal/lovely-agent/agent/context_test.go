package agent

import (
	"context"
	"strings"
	"testing"

	"lovelybuddy/server/internal/lovely-agent/model"
)

func TestBuildOrderAndTrim(t *testing.T) {
	cc := ContextConfig{
		SystemPrompt:  func(persona string) string { return "人设:" + persona },
		PersonaLoader: func(string) (string, bool) { return "你是猫。", true },
		History: func() []model.Message {
			history := make([]model.Message, 0, 25)
			for i := 0; i < 25; i++ {
				history = append(history, model.Message{Role: "user", Content: "m" + string(rune('a'+i))})
			}
			return history
		},
		HistoryLimit: 20,
	}
	msgs := Build(context.Background(), cc, "haru", "最新")
	if len(msgs) != 22 { // system + 20 历史 + 1 输入
		t.Fatalf("len=%d", len(msgs))
	}
	if msgs[0].Role != "system" || !strings.HasPrefix(msgs[0].Content, "人设:你是猫。") {
		t.Fatalf("首条应为 system 人设: %+v", msgs[0])
	}
	if msgs[len(msgs)-1].Role != "user" || msgs[len(msgs)-1].Content != "最新" {
		t.Fatalf("末条应为最新输入: %+v", msgs[len(msgs)-1])
	}
	if msgs[1].Content != "m"+string(rune('a'+5)) { // 裁掉最旧 5 条
		t.Fatalf("历史裁剪应保最近 20 条: %+v", msgs[1])
	}
}

func TestBuildNoHistoryLimit(t *testing.T) {
	cc := ContextConfig{
		SystemPrompt:  func(string) string { return "s" },
		PersonaLoader: func(string) (string, bool) { return "", false },
		History:       func() []model.Message { return nil },
	}
	msgs := Build(context.Background(), cc, "", "hi")
	if len(msgs) != 2 || msgs[0].Role != "system" || msgs[1].Content != "hi" {
		t.Fatalf("无历史应仅 system+user: %+v", msgs)
	}
}

func TestBuildMemorySegment(t *testing.T) {
	cc := ContextConfig{
		SystemPrompt:  func(string) string { return "s" },
		PersonaLoader: func(string) (string, bool) { return "", false },
		History:       func() []model.Message { return nil },
		Memory:        func(string) string { return "关于用户的长期记忆：\n- [偏好] 喜欢喝拿铁" },
	}
	msgs := Build(context.Background(), cc, "", "hi")
	if len(msgs) != 3 {
		t.Fatalf("有记忆段应 3 条（system+记忆段+user）: %+v", msgs)
	}
	if msgs[1].Role != "system" || !strings.HasPrefix(msgs[1].Content, "关于用户的长期记忆") {
		t.Fatalf("记忆段应插在历史后、输入前: %+v", msgs[1])
	}
}

func TestBuildMemoryEmptyOrNil(t *testing.T) {
	base := ContextConfig{
		SystemPrompt:  func(string) string { return "s" },
		PersonaLoader: func(string) (string, bool) { return "", false },
		History:       func() []model.Message { return nil },
		Memory:        func(string) string { return "" },
	}
	if got := Build(context.Background(), base, "", "hi"); len(got) != 2 {
		t.Fatalf("空记忆段不追加消息: %+v", got)
	}
	base.Memory = nil
	if got := Build(context.Background(), base, "", "hi"); len(got) != 2 {
		t.Fatalf("nil Memory 不追加消息: %+v", got)
	}
}

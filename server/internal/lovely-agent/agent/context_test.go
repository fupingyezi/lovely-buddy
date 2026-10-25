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

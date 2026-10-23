package service

import (
	"strings"
	"testing"
	"time"

	"lovelybuddy/server/internal/dao"
)

func TestSystemPromptDefaultPersona(t *testing.T) {
	got := SystemPrompt("")
	if !strings.Contains(got, "桌面宠物") || !strings.Contains(got, "[motion:") {
		t.Fatalf("默认人设/动作协议缺失: %q", got)
	}
}

func TestSystemPromptCustomPersonaPrepends(t *testing.T) {
	got := SystemPrompt("你是猫。")
	if !strings.HasPrefix(got, "你是猫。") {
		t.Fatalf("自定义人设应在最前（稳定前缀缓存友好）: %q", got)
	}
	if !strings.Contains(got, "surprised") {
		t.Fatal("动作协议应包含全部意图说明")
	}
}

func TestBuildMessagesOrderAndTrim(t *testing.T) {
	history := []dao.Message{}
	for i := 0; i < 25; i++ {
		history = append(history, dao.Message{Role: "user", Content: "m" + string(rune('a'+i)), CreatedAt: time.Now()})
	}
	msgs := BuildMessages("你是猫。", history, "最新", 20)
	if len(msgs) != 22 { // system + 20 历史 + 1 输入
		t.Fatalf("len=%d", len(msgs))
	}
	if msgs[0].Role != "system" || !strings.HasPrefix(msgs[0].Content, "你是猫。") {
		t.Fatalf("首条应为 system 人设: %+v", msgs[0])
	}
	if msgs[len(msgs)-1].Role != "user" || msgs[len(msgs)-1].Content != "最新" {
		t.Fatalf("末条应为最新输入: %+v", msgs[len(msgs)-1])
	}
	if msgs[1].Content != "m"+string(rune('a'+5)) { // 裁掉最旧 5 条
		t.Fatalf("历史裁剪应保最近 20 条: %+v", msgs[1])
	}
}

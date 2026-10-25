package service

import (
	"strings"
	"testing"
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

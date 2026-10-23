package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, ".env")
	if err := os.WriteFile(p, []byte(`
# 注释行
DEEPSEEK_API_KEY=sk-test
QUOTED="带引号"
EXISTING=override-me

BROKEN_LINE_NO_EQ
`), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DEEPSEEK_API_KEY", "") // 清空避免 dev shell 的真实 key 干扰（空视为未设置，.env 可写入）
	t.Setenv("EXISTING", "keep")    // 已存在的环境变量优先，不被 .env 覆盖

	if err := LoadEnvFile(p); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("DEEPSEEK_API_KEY"); got != "sk-test" {
		t.Fatalf("DEEPSEEK_API_KEY=%q", got)
	}
	if got := os.Getenv("QUOTED"); got != "带引号" {
		t.Fatalf("QUOTED=%q（应剥成对引号）", got)
	}
	if got := os.Getenv("EXISTING"); got != "keep" {
		t.Fatalf("EXISTING=%q（已存在不应被覆盖）", got)
	}
}

func TestLoadEnvFileMissingIsNoop(t *testing.T) {
	if err := LoadEnvFile(filepath.Join(t.TempDir(), "nope.env")); err != nil {
		t.Fatalf("文件不存在应返回 nil, got %v", err)
	}
}

func TestLoadReadsChatConfig(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, ".env")
	if err := os.WriteFile(p, []byte("LOVELYBUDDY_CHAT_PROVIDER=dashscope\nLOVELYBUDDY_CHAT_MODEL=qwen-turbo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOVELYBUDDY_ENV_FILE", p) // Load 的 env 文件路径可注入，测试不依赖工作目录
	t.Setenv("LOVELYBUDDY_CHAT_PROVIDER", "")
	t.Setenv("LOVELYBUDDY_CHAT_MODEL", "")
	if got := Load().Chat.Provider; got != "dashscope" {
		t.Fatalf("provider=%q", got)
	}
	if got := Load().Chat.Model; got != "qwen-turbo" {
		t.Fatalf("model=%q", got)
	}
}

package service

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lovelybuddy/server/internal/configstore"
)

func TestPersonaUpdateRoundtrip(t *testing.T) {
	t.Setenv("LOVELYBUDDY_CONFIG_FILE", filepath.Join(t.TempDir(), "config.json"))
	f := &configstore.File{}
	s := NewPersonaService(f)
	st, err := s.Update("  你是一只猫。  ", true)
	if err != nil || st.Text != "你是一只猫。" || !st.Enabled {
		t.Fatalf("st=%+v err=%v", st, err)
	}
	if f.Persona.Text != "你是一只猫。" {
		t.Fatal("应落盘")
	}
	if got := s.State(); got.Text != "你是一只猫。" || !got.Enabled {
		t.Fatalf("State 不符: %+v", got)
	}
}

func TestPersonaUpdateTooLongRejected(t *testing.T) {
	t.Setenv("LOVELYBUDDY_CONFIG_FILE", filepath.Join(t.TempDir(), "config.json"))
	f := &configstore.File{}
	s := NewPersonaService(f)
	if _, err := s.Update(strings.Repeat("喵", 2001), false); !errors.Is(err, ErrPersonaTooLong) {
		t.Fatalf("超长应返回 ErrPersonaTooLong，得 %v", err)
	}
	if f.Persona.Text != "" {
		t.Fatal("非法输入不应落盘")
	}
}

// Save 失败（配置文件路径指向目录）→ 返回错误且内存态回滚到保存前的值。
func TestPersonaSaveFailureRollsBack(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "config-dir")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOVELYBUDDY_CONFIG_FILE", dir)
	f := &configstore.File{Persona: configstore.Persona{Text: "旧人设", Enabled: true}}
	s := NewPersonaService(f)
	if _, err := s.Update("新人设", false); err == nil {
		t.Fatal("Save 失败应报错")
	}
	if got := s.State(); got.Text != "旧人设" || !got.Enabled {
		t.Fatalf("Save 失败应回滚内存态: %+v", got)
	}
}

func TestPersonaCustomEmptyDisables(t *testing.T) {
	s := NewPersonaService(&configstore.File{Persona: configstore.Persona{Text: "", Enabled: true}})
	if c := s.Custom(); c.Enabled {
		t.Fatal("空文案应视为关闭")
	}
}

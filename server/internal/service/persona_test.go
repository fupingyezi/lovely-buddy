package service

import (
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
	if _, err := s.Update(strings.Repeat("喵", 2001), false); err == nil {
		t.Fatal("超长应报错")
	}
	if f.Persona.Text != "" {
		t.Fatal("非法输入不应落盘")
	}
}

func TestPersonaCustomEmptyDisables(t *testing.T) {
	s := NewPersonaService(&configstore.File{Persona: configstore.Persona{Text: "", Enabled: true}})
	if c := s.Custom(); c.Enabled {
		t.Fatal("空文案应视为关闭")
	}
}

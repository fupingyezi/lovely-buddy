package configstore

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// tmpPath 把配置文件指到临时目录（测试隔离，不碰真实用户配置）。
func tmpPath(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("LOVELYBUDDY_CONFIG_FILE", p)
	return p
}

func TestLoadMissingFileReturnsEmpty(t *testing.T) {
	tmpPath(t)
	f, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(f.Connections) != 0 || f.ActiveID != "" {
		t.Fatalf("期望空配置，得 %+v", f)
	}
}

func TestSaveLoadRoundtripAndPerm(t *testing.T) {
	p := tmpPath(t)
	now := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	f := &File{ActiveID: "x"}
	c := f.Add(Connection{Provider: "deepseek", Model: "deepseek-chat", APIKey: "sk-1234abcd", LastCheck: &now, CheckFail: false})
	if c.ID == "" {
		t.Fatal("Add 应生成非空 ID")
	}
	f.ActiveID = c.ID
	if err := f.Save(); err != nil {
		t.Fatalf("Save: %v", err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("期望 0600，得 %o", info.Mode().Perm())
	}
	got, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.ActiveID != c.ID || len(got.Connections) != 1 {
		t.Fatalf("roundtrip 不一致: %+v", got)
	}
	if got.Connections[0].APIKey != "sk-1234abcd" || !got.Connections[0].LastCheck.Equal(now) {
		t.Fatalf("字段丢失: %+v", got.Connections[0])
	}
}

func TestLoadCorruptedReturnsError(t *testing.T) {
	p := tmpPath(t)
	if err := os.WriteFile(p, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(); err == nil {
		t.Fatal("损坏 JSON 应报错")
	}
}

func TestMaskKey(t *testing.T) {
	cases := map[string]string{
		"sk-1234567890abcdef3f2a": "sk-" + "••••••••••••••••" + "3f2a",
		"short":                   "••••••••••••••••",
		"":                        "••••••••••••••••",
	}
	for in, want := range cases {
		if got := MaskKey(in); got != want {
			t.Errorf("MaskKey(%q) = %q, 期望 %q", in, got, want)
		}
	}
}

func TestRemoveActiveFallsBackToFirstRemaining(t *testing.T) {
	f := &File{}
	a := f.Add(Connection{Provider: "deepseek"})
	b := f.Add(Connection{Provider: "dashscope"})
	f.ActiveID = a.ID
	if !f.Remove(a.ID) {
		t.Fatal("Remove 应成功")
	}
	if f.ActiveID != b.ID {
		t.Fatalf("删除激活项应回退剩余第一条，得 %q", f.ActiveID)
	}
	if !f.Remove(b.ID) {
		t.Fatal("Remove 应成功")
	}
	if f.ActiveID != "" {
		t.Fatalf("删光后 active 应为空，得 %q", f.ActiveID)
	}
	if f.Remove("ghost") {
		t.Fatal("删除不存在 id 应返回 false")
	}
}

func TestSetActiveAndFind(t *testing.T) {
	f := &File{}
	c := f.Add(Connection{Provider: "zhipu", Model: "glm-4-flash"})
	if f.SetActive("ghost") {
		t.Fatal("未知 id 激活应返回 false")
	}
	if !f.SetActive(c.ID) || f.ActiveID != c.ID {
		t.Fatal("激活失败")
	}
	if got := f.Active(); got == nil || got.Model != "glm-4-flash" {
		t.Fatal("Active 应返回激活连接")
	}
	if got := f.Find(c.ID); got == nil || got.Provider != "zhipu" {
		t.Fatal("Find 应命中")
	}
	if f.Find("ghost") != nil {
		t.Fatal("Find 未知 id 应为 nil")
	}
}

package assets

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPersonaText(t *testing.T) {
	root := t.TempDir()
	writePersonaTree(t, root)

	if txt, ok := PersonaText(root, "haru"); !ok || txt != "你是猫。" {
		t.Fatalf("haru=%q ok=%v", txt, ok)
	}
	// slug 不存在 / 无 avatar.json → false
	if _, ok := PersonaText(root, "plain"); ok {
		t.Fatal("无 avatar.json 应 false")
	}
	// persona 指向的文件缺失 → false
	if _, ok := PersonaText(root, "metanull"); ok {
		t.Fatal("persona 文件缺失应 false")
	}
	// 路径穿越 → false（绝不读模型根目录之外）
	if _, ok := PersonaText(root, "evil"); ok {
		t.Fatal("穿越路径应 false")
	}
	// 非法 slug → false
	if _, ok := PersonaText(root, "../haru"); ok {
		t.Fatal("非法 slug 应 false")
	}
	// persona 文件为空 → false
	if _, ok := PersonaText(root, "empty"); ok {
		t.Fatal("空人设应 false")
	}
}

func writePersonaTree(t *testing.T, root string) {
	t.Helper()
	files := map[string]string{
		"haru/avatar.json":        `{"name":"haru","persona":"persona/haru.txt"}`,
		"haru/persona/haru.txt":   "  你是猫。  ",
		"plain/p.model3.json":     `{"Version":3}`,
		"metanull/avatar.json":    `{"name":"m","persona":"missing.txt"}`,
		"evil/avatar.json":        `{"name":"e","persona":"../../secret.txt"}`,
		"empty/avatar.json":       `{"name":"x","persona":"persona/empty.txt"}`,
		"empty/persona/empty.txt": "   ",
	}
	for rel, content := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

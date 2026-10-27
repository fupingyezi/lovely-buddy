package assets

import (
	"os"
	"path/filepath"
	"testing"
)

// 构造测试形象目录树
func writeDir(t *testing.T, root string, files map[string]string) {
	t.Helper()
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

func TestDetect(t *testing.T) {
	root := t.TempDir()
	writeDir(t, root, map[string]string{
		"haru/haru.model3.json":            `{"Version":3,"Expressions":[{"Name":"Angry"},{"Name":"Happy"}]}`,
		"haru/avatar.json":                 `{"name":"Haru","author":"Live2D","version":"1.0","license":"free","homepage":"https://example.com","persona":"persona/haru.txt","actions":{"happy":{"motion":"Tap","motionIndex":4,"expression":"F_FUN"},"sad":{"expression":"F_SAD"}}}`,
		"haru/persona/haru.txt":            "你是一只猫",
		"shizuku/a/b/c/shizuku.model.json": `{"type":"Live2DModelSetting","expressions":[{"name":"smile"}]}`,
		"broken/avatar.json":               `{not json`,
		"broken/deep.model3.json":          `{"Version":3}`,
		"noentry/avatar.json":              `{"name":"空"}`,
		".hidden-dir/x.model3.json":        `{"Version":3}`,
		"metanull/model3/x.model3.json":    `{"Version":3}`,
		"metanull/avatar.json":             `{"name":"N","persona":"missing.txt"}`,
	})
	// broken 的入口下沉 4 层目录（rel 含 4 个分隔符，超过 ≤3 层限制）→ 应探测不到
	os.MkdirAll(filepath.Join(root, "broken/a/b/c/d"), 0o755)
	if err := os.Rename(filepath.Join(root, "broken/deep.model3.json"), filepath.Join(root, "broken/a/b/c/d/deep.model3.json")); err != nil {
		t.Fatal(err)
	}

	got := Detect(root)
	if len(got) != 3 { // haru、shizuku、metanull；broken/noentry/点目录被过滤
		t.Fatalf("len=%d, got=%+v", len(got), got)
	}
	// 按 slug 排序，haru 在最前
	if got[0].Slug != "haru" || got[0].Name != "Haru" || got[0].Author != "Live2D" || got[0].Version != "1.0" ||
		got[0].License != "free" || got[0].Homepage != "https://example.com" || got[0].Persona != "persona/haru.txt" ||
		got[0].Kind != "moc3" || got[0].Entry != "haru/haru.model3.json" {
		t.Fatalf("haru 字段不符: %+v", got[0])
	}
	if got[0].SizeBytes <= 0 {
		t.Fatalf("haru SizeBytes 应为正数: %+v", got[0])
	}
	if got[0].Expressions != 2 {
		t.Fatalf("haru Expressions 应为 2: %+v", got[0])
	}
	if got[0].Actions["happy"].Motion != "Tap" || got[0].Actions["happy"].MotionIndex == nil ||
		*got[0].Actions["happy"].MotionIndex != 4 || got[0].Actions["happy"].Expression != "F_FUN" {
		t.Fatalf("haru Actions.happy 不符: %+v", got[0].Actions)
	}
	if got[0].Actions["sad"].Expression != "F_SAD" || got[0].Actions["sad"].MotionIndex != nil {
		t.Fatalf("haru Actions.sad 不符: %+v", got[0].Actions)
	}
	// shizuku：无 avatar.json → Name 回退 slug；3 层嵌套入口仍可探测（排序在 metanull 后）
	if got[2].Slug != "shizuku" || got[2].Name != "shizuku" || got[2].Kind != "moc" ||
		got[2].Entry != "shizuku/a/b/c/shizuku.model.json" {
		t.Fatalf("shizuku 字段不符: %+v", got[2])
	}
	if got[2].Expressions != 1 {
		t.Fatalf("shizuku Expressions 应为 1（cubism2 小写 expressions 字段）: %+v", got[2])
	}
	if got[2].Actions != nil {
		t.Fatalf("无 avatar.json 的 shizuku Actions 应为 nil: %+v", got[2].Actions)
	}
	// metanull：persona 文件缺失 → Persona 置空
	for _, a := range got {
		if a.Slug == "metanull" && a.Persona != "" {
			t.Fatalf("metanull persona 应为空: %+v", a)
		}
	}
	// noentry / 深层 broken / .hidden-dir 均被过滤
	for _, a := range got {
		if a.Slug == "noentry" || a.Slug == "broken" || a.Slug == ".hidden-dir" {
			t.Fatalf("不应出现 %s", a.Slug)
		}
	}
}

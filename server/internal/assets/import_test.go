package assets

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// makeZip 在 t.TempDir 生成一个 zip，返回路径。files 的 key 为条目相对路径。
func makeZip(t *testing.T, files map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "test.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestImportFromZip(t *testing.T) {
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{
		"tianyi/avatar.json":        `{"name":"洛天依","author":"me","license":"unknown"}`,
		"tianyi/tianyi.model3.json": `{"Version":3}`,
		"tianyi/textures/tex.png":   "png",
	})
	av, err := Import(root, ImportSource{Type: "path", Value: zipPath})
	if err != nil {
		t.Fatal(err)
	}
	if av.Slug != "test-zip" || av.Name != "洛天依" || av.Author != "me" || av.Kind != "moc3" ||
		av.Entry != "test-zip/tianyi.model3.json" || av.Source != "local" {
		t.Fatalf("导入结果不符: %+v", av)
	}
	// 目录已就位、侧车已写入、无 staging 残留
	if _, err := os.Stat(filepath.Join(root, "test-zip", "tianyi.model3.json")); err != nil {
		t.Fatal("入口文件未入库", err)
	}
	if b, err := os.ReadFile(filepath.Join(root, "test-zip", ".lovelybuddy.json")); err != nil || !strings.Contains(string(b), `"source":"local"`) {
		t.Fatalf("侧车不符: %s %v", b, err)
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 1 {
		t.Fatalf("应只有形象目录，got %d", len(entries))
	}
}

func TestImportZipSlip(t *testing.T) {
	root := t.TempDir()
	for _, evil := range []string{"../../evil.txt", "/abs.txt"} {
		zipPath := makeZip(t, map[string]string{evil: "x", "ok/x.model3.json": `{"Version":3}`})
		if _, err := Import(root, ImportSource{Type: "path", Value: zipPath}); err == nil {
			t.Fatalf("zip-slip 应报错: %s", evil)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "..", "evil.txt")); !os.IsNotExist(err) {
		t.Fatal("evil.txt 不应逃逸")
	}
	entries, _ := os.ReadDir(root)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".staging") {
			t.Fatalf("staging 残留: %s", e.Name())
		}
	}
}

func TestImportNoEntry(t *testing.T) {
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{"readme.txt": "hi"})
	_, err := Import(root, ImportSource{Type: "path", Value: zipPath})
	if err == nil || !strings.Contains(err.Error(), "未找到 Live2D 模型入口") {
		t.Fatalf("应报入口错误: %v", err)
	}
}

func TestImportSlugCollision(t *testing.T) {
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{"x.model3.json": `{"Version":3}`})
	if _, err := Import(root, ImportSource{Type: "path", Value: zipPath}); err != nil {
		t.Fatal(err)
	}
	av, err := Import(root, ImportSource{Type: "path", Value: zipPath})
	if err != nil {
		t.Fatal(err)
	}
	if av.Slug != "test-zip-2" {
		t.Fatalf("冲突 slug 应为 test-zip-2: %s", av.Slug)
	}
}

func TestImportFromDir(t *testing.T) {
	root := t.TempDir()
	src := t.TempDir()
	writeDir(t, src, map[string]string{"s.model.json": `{"type":"Live2DModelSetting"}`})
	av, err := Import(root, ImportSource{Type: "path", Value: src})
	if err != nil {
		t.Fatal(err)
	}
	// 原目录不被移动
	if _, err := os.Stat(filepath.Join(src, "s.model.json")); err != nil {
		t.Fatal("原目录不应被移动", err)
	}
	if av.Kind != "moc" {
		t.Fatalf("kind=%s", av.Kind)
	}
}

func TestImportOversize(t *testing.T) {
	old := maxUnpacked
	maxUnpacked = 16
	defer func() { maxUnpacked = old }()
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{
		"big/x.model3.json": strings.Repeat("a", 100),
	})
	if _, err := Import(root, ImportSource{Type: "path", Value: zipPath}); err == nil || !strings.Contains(err.Error(), "上限") {
		t.Fatalf("应报大小上限: %v", err)
	}
}

func TestDelete(t *testing.T) {
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{"x.model3.json": `{"Version":3}`})
	av, err := Import(root, ImportSource{Type: "path", Value: zipPath})
	if err != nil {
		t.Fatal(err)
	}
	if err := Delete(root, av.Slug); err != nil {
		t.Fatal(err)
	}
	if len(Detect(root)) != 0 {
		t.Fatal("删除后应无形象")
	}
	for _, bad := range []string{"../x", "..", ".", "a/b", ""} {
		if err := Delete(root, bad); err == nil {
			t.Fatalf("非法 slug 应报错: %q", bad)
		}
	}
}

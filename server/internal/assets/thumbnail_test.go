package assets

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, root, rel string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestProbeThumbnail(t *testing.T) {
	dir := t.TempDir()

	t.Run("顶层 icon.png 命中", func(t *testing.T) {
		d := filepath.Join(dir, "a")
		writeFile(t, dir, "a/icon.png")
		if got := probeThumbnail(d); got != "icon.png" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("一层子目录 ico_ 命中", func(t *testing.T) {
		d := filepath.Join(dir, "b")
		writeFile(t, dir, "b/foo/ico_avatar.png")
		if got := probeThumbnail(d); got != "foo/ico_avatar.png" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("优先级 icon 高于 preview", func(t *testing.T) {
		d := filepath.Join(dir, "c")
		writeFile(t, dir, "c/preview.png")
		writeFile(t, dir, "c/icon.jpg")
		if got := probeThumbnail(d); got != "icon.jpg" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("无候选返回空（texture 贴图不算）", func(t *testing.T) {
		d := filepath.Join(dir, "d")
		writeFile(t, dir, "d/haru.model3.json")
		writeFile(t, dir, "d/texture_00.png")
		if got := probeThumbnail(d); got != "" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("点目录与二层子目录跳过", func(t *testing.T) {
		d := filepath.Join(dir, "e")
		writeFile(t, dir, "e/.cache/icon.png")
		writeFile(t, dir, "e/x/y/icon.png")
		if got := probeThumbnail(d); got != "" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("非图片扩展名不命中", func(t *testing.T) {
		d := filepath.Join(dir, "f")
		writeFile(t, dir, "f/icon.zip")
		if got := probeThumbnail(d); got != "" {
			t.Fatalf("got %q", got)
		}
	})
}

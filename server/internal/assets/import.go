package assets

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 上限为包级变量：单测可调小验证防护逻辑。
var (
	maxEntries  = 20000          // zip 条目数上限（zip 炸弹防护）
	maxUnpacked = int64(1 << 30) // 解压/复制总字节上限 1GB
)

// ImportSource 描述导入来源（API 请求体 {source:{type,value}}）。
type ImportSource struct {
	Type  string `json:"type"`  // "url" | "path"
	Value string `json:"value"` // HTTPS URL 或本地目录/zip 路径
}

// Import 导入形象到模型根目录：path=目录复制/zip 解压；url=下载后解压。
// 成功后返回新形象信息（调用方用于自动应用）。
func Import(root string, src ImportSource) (Avatar, error) {
	switch src.Type {
	case "url":
		tmp, err := Download(root, src.Value)
		if err != nil {
			return Avatar{}, err
		}
		defer os.Remove(tmp)
		return importArchive(root, tmp, "url", src.Value)
	case "path":
		st, err := os.Stat(src.Value)
		if err != nil {
			return Avatar{}, fmt.Errorf("读取来源失败: %w", err)
		}
		if st.IsDir() {
			return importDir(root, src.Value, "local", src.Value)
		}
		return importArchive(root, src.Value, "local", src.Value)
	default:
		return Avatar{}, fmt.Errorf("未知来源类型: %s", src.Type)
	}
}

// importArchive 解压 zip 到 staging 并入库。staging 建在 root 内保证 rename 同文件系统。
func importArchive(root, zipPath, source, value string) (Avatar, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return Avatar{}, fmt.Errorf("不是有效的 zip: %w", err)
	}
	defer zr.Close()
	return withStaging(root, func(staging string) (Avatar, error) {
		if err := extractZip(zr, staging); err != nil {
			return Avatar{}, err
		}
		return finalize(root, staging, source, value)
	})
}

// importDir 复制本地目录到 staging（不移动用户原目录）。
func importDir(root, srcDir, source, value string) (Avatar, error) {
	return withStaging(root, func(staging string) (Avatar, error) {
		var total int64
		err := filepath.WalkDir(srcDir, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				if p != srcDir && strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return err
			}
			if total+info.Size() > maxUnpacked {
				return fmt.Errorf("目录总大小超过上限 1GB")
			}
			total += info.Size()
			rel, err := filepath.Rel(srcDir, p)
			if err != nil {
				return err
			}
			dst := filepath.Join(staging, rel)
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return err
			}
			return copyFile(p, dst)
		})
		if err != nil {
			return Avatar{}, err
		}
		return finalize(root, staging, source, value)
	})
}

// withStaging 建临时目录、执行 fn、清理。
func withStaging(root string, fn func(staging string) (Avatar, error)) (Avatar, error) {
	staging, err := os.MkdirTemp(root, ".staging-")
	if err != nil {
		return Avatar{}, err
	}
	defer os.RemoveAll(staging)
	return fn(staging)
}

// extractZip 解压所有文件条目：zip-slip 防护 + 炸弹防护。
// 条目名统一把 \\ 换成 /（部分 Windows 工具产出反斜杠条目）。
func extractZip(zr *zip.ReadCloser, dest string) error {
	if len(zr.File) > maxEntries {
		return fmt.Errorf("zip 条目数超过上限 %d", maxEntries)
	}
	var total int64
	for _, f := range zr.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		rel := filepath.Clean(filepath.FromSlash(name))
		if rel == "." || filepath.IsAbs(rel) || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("zip 含非法路径: %s", f.Name) // zip-slip 拒绝
		}
		target := filepath.Join(dest, rel)
		if target != dest && !strings.HasPrefix(target, dest+string(filepath.Separator)) {
			return fmt.Errorf("zip 含越界路径: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		r, err := f.Open()
		if err != nil {
			return err
		}
		w, err := os.Create(target)
		if err != nil {
			r.Close()
			return err
		}
		n, err := io.Copy(w, io.LimitReader(r, maxUnpacked-total+1))
		w.Close()
		r.Close()
		if err != nil {
			return err
		}
		total += n
		if total > maxUnpacked {
			return fmt.Errorf("解压总大小超过上限 1GB")
		}
	}
	return nil
}

// finalize staging → 形象目录：解包单层目录、探测入口、生成 slug（冲突加后缀）、
// 原子 rename 入库、写来源侧车。
func finalize(root, staging, source, value string) (Avatar, error) {
	avatarDir := staging
	if single, ok := unwrapSingle(staging); ok {
		avatarDir = single
	}
	if rel, _ := probeEntry(avatarDir); rel == "" {
		return Avatar{}, fmt.Errorf("未找到 Live2D 模型入口（*.model3.json / *.model.json，≤3 层）")
	}
	slug := slugFromValue(source, value)
	finalPath := filepath.Join(root, slug)
	for i := 2; ; i++ {
		if _, err := os.Lstat(finalPath); err != nil {
			break // 不存在，可用（本地单用户工具，容忍极小 TOCTOU）
		}
		finalPath = filepath.Join(root, fmt.Sprintf("%s-%d", slug, i))
	}
	if err := os.Rename(avatarDir, finalPath); err != nil {
		return Avatar{}, fmt.Errorf("入库失败: %w", err)
	}
	writeSidecar(finalPath, source, value)
	av, _ := inspect(finalPath)
	return av, nil
}

// unwrapSingle staging 内恰好一个目录且无文件时返回该目录（解包常见外层目录）。
func unwrapSingle(dir string) (string, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || !entries[0].IsDir() {
		return dir, false
	}
	return filepath.Join(dir, entries[0].Name()), true
}

// slugFromValue 由来源生成 slug：URL 取路径末段、路径取 basename，再 sanitize。
func slugFromValue(source, value string) string {
	name := filepath.Base(value)
	if source == "url" {
		if u, err := url.Parse(value); err == nil && u.Path != "" && u.Path != "/" {
			name = filepath.Base(u.Path)
		}
	}
	return slugify(name)
}

// slugify 转安全目录名：[a-z0-9_-]，其余字符替换为 -；空则 "avatar"。
// 非拉丁字符（如中文名）会全部替换，落 "avatar" 系列。
func slugify(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		return "avatar"
	}
	return s
}

// writeSidecar 记录来源（审计 + UI 展示来源），写失败不影响导入。
func writeSidecar(dir, source, value string) {
	b, _ := json.Marshal(sidecar{Source: source, Value: value, At: time.Now().Format(time.RFC3339)})
	_ = os.WriteFile(filepath.Join(dir, ".lovelybuddy.json"), b, 0o644)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

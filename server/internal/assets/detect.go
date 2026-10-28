package assets

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Detect 扫描模型根目录，返回所有形象（root 的直接子目录，跳过点目录）。
// 结果按 slug 排序；root 不存在或不可读时返回空切片。
func Detect(root string) []Avatar {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []Avatar
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if av, ok := inspect(filepath.Join(root, e.Name())); ok {
			out = append(out, av)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out
}

// inspect 读取单个形象目录的元数据并探测入口；无入口返回 ok=false。
func inspect(dir string) (Avatar, bool) {
	slug := filepath.Base(dir)
	meta := avatarJSON{}
	if b, err := os.ReadFile(filepath.Join(dir, "avatar.json")); err == nil {
		_ = json.Unmarshal(b, &meta) // 损坏按缺省处理
	}
	rel, kind := probeEntry(dir)
	if rel == "" {
		return Avatar{}, false
	}
	av := Avatar{
		Slug:     slug,
		Name:     meta.Name,
		Author:   meta.Author,
		Version:  meta.Version,
		License:  meta.License,
		Homepage: meta.Homepage,
		Persona:  meta.Persona,
		Kind:     kind,
		Entry:    filepath.ToSlash(filepath.Join(slug, rel)),
	}
	av.Actions = meta.Actions
	av.SizeBytes = dirSize(dir)
	av.Thumbnail = probeThumbnail(dir)
	av.Expressions = expressionCount(filepath.Join(dir, filepath.FromSlash(rel)))
	if av.Name == "" {
		av.Name = slug
	}
	// persona 文件不存在则视为无（回退全局人设），不报错
	if av.Persona != "" {
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(av.Persona))); err != nil {
			av.Persona = ""
		}
	}
	if b, err := os.ReadFile(filepath.Join(dir, ".lovelybuddy.json")); err == nil {
		var sc sidecar
		if json.Unmarshal(b, &sc) == nil {
			av.Source = sc.Source
		}
	}
	return av, true
}

// probeEntry 在形象目录内找模型入口（≤3 层，与 M1 的递归深度一致），优先 Cubism 4。
// 返回相对形象目录的路径（斜杠分隔）与 kind；找不到返回 "", ""。
func probeEntry(dir string) (rel string, kind string) {
	var firstMoc3, firstMoc string
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // 不可读的跳过
		}
		if d.IsDir() {
			if p != dir && strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		r, err := filepath.Rel(dir, p)
		if err != nil {
			return nil
		}
		r = filepath.ToSlash(r)
		if strings.Count(r, "/") > 3 {
			return nil // 超过 3 层
		}
		if firstMoc3 == "" && strings.HasSuffix(d.Name(), ".model3.json") {
			firstMoc3 = r
		} else if firstMoc == "" && strings.HasSuffix(d.Name(), ".model.json") {
			firstMoc = r
		}
		return nil
	})
	if firstMoc3 != "" {
		return firstMoc3, "moc3"
	}
	if firstMoc != "" {
		return firstMoc, "moc"
	}
	return "", ""
}

// dirSize 递归统计形象目录总字节数（WalkDir 求和，读不到的跳过）。
func dirSize(dir string) int64 {
	var n int64
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			if info, err := d.Info(); err == nil {
				n += info.Size()
			}
		}
		return nil
	})
	return n
}

// expressionCount 读取入口 json 的 Expressions 数组长度（encoding/json 大小写不敏感匹配，
// Cubism 4 大写 Expressions / Cubism 2 小写 expressions 通用）。
// 读不到/解析失败/无该字段 → 0（前端省略「N 组表情」段）。
func expressionCount(entry string) int {
	b, err := os.ReadFile(entry)
	if err != nil {
		return 0
	}
	var doc struct {
		Expressions []json.RawMessage `json:"Expressions"`
	}
	if json.Unmarshal(b, &doc) != nil {
		return 0
	}
	return len(doc.Expressions)
}

// thumbLimit 预览图大小上限（超过视为贴图/截图，不采）。
const thumbLimit = 2 << 20

// thumbNames 候选名优先级表（下标即优先级，0 最高）；前缀匹配后接图片扩展名。
var thumbNames = []string{"icon.", "ico_", "preview.", "cover.", "thumbnail."}

// probeThumbnail 在形象目录顶层与一层子目录找自带预览图（icon.png / ico_*.png / preview.png /
// cover.png / thumbnail.png 等，扩展名限 png/jpg/jpeg/webp），按候选名优先级取最优；
// 找不到返回空串。纹理贴图（texture_00.png）是拆件图集，不是预览图——不探测。
func probeThumbnail(dir string) string {
	best, bestRank := "", len(thumbNames)
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // 不可读的跳过
		}
		if d.IsDir() {
			if p == dir {
				return nil
			}
			rel := filepathRel(dir, p)
			if strings.HasPrefix(d.Name(), ".") || strings.Count(rel, "/") >= 1 {
				return filepath.SkipDir // 点目录或二层以上子目录
			}
			return nil
		}
		rel := filepathRel(dir, p)
		if strings.Count(rel, "/") > 1 {
			return nil // 只找两层
		}
		if info, err := d.Info(); err == nil && info.Size() > thumbLimit {
			return nil
		}
		if r := rankThumb(strings.ToLower(d.Name())); r >= 0 && r < bestRank {
			best, bestRank = rel, r
		}
		return nil
	})
	return best
}

// filepathRel 忽略错误的 Rel 并转斜杠（探测遍历，读不到不影响）。
func filepathRel(base, p string) string {
	r, err := filepath.Rel(base, p)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(r)
}

// rankThumb 按优先级表打分；不匹配或非图片扩展名返回 -1。
func rankThumb(lower string) int {
	if !isThumbExt(lower) {
		return -1
	}
	base := filepath.Base(lower)
	for i, p := range thumbNames {
		if strings.HasPrefix(base, p) {
			return i
		}
	}
	return -1
}

// isThumbExt 图片扩展名（png/jpg/jpeg/webp）。
func isThumbExt(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".webp":
		return true
	}
	return false
}

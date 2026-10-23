package assets

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// PersonaText 读取形象人设文本：avatar.json 的 persona 字段指向形象目录内的相对路径。
// 无 avatar.json / 无 persona / slug 非法 / 路径越界 / 文件缺失或为空 → ("", false)。
func PersonaText(root, slug string) (string, bool) {
	if !slugRe.MatchString(slug) || slug == "." || slug == ".." {
		return "", false
	}
	b, err := os.ReadFile(filepath.Join(root, slug, "avatar.json"))
	if err != nil {
		return "", false
	}
	var meta struct {
		Persona string `json:"persona"`
	}
	if json.Unmarshal(b, &meta) != nil || meta.Persona == "" {
		return "", false
	}
	dir := filepath.Join(root, slug)
	p := filepath.Join(dir, filepath.FromSlash(meta.Persona))
	// persona 相对路径必须仍在形象目录内（拒绝绝对路径与 .. 穿越）
	if !strings.HasPrefix(p, dir+string(filepath.Separator)) {
		return "", false
	}
	b, err = os.ReadFile(p)
	if err != nil {
		return "", false
	}
	txt := strings.TrimSpace(string(b))
	return txt, txt != ""
}

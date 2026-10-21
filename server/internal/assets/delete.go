package assets

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// slug 只允许 [A-Za-z0-9._-] 且以字母数字开头，杜绝路径穿越。
var slugRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// Delete 删除形象目录（仅限模型根目录内）。
func Delete(root, slug string) error {
	if !slugRe.MatchString(slug) || slug == "." || slug == ".." {
		return fmt.Errorf("非法 slug: %s", slug)
	}
	target := filepath.Join(root, slug)
	if target == root || !strings.HasPrefix(target, root+string(filepath.Separator)) {
		return fmt.Errorf("越界路径")
	}
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("删除失败: %w", err)
	}
	return nil
}

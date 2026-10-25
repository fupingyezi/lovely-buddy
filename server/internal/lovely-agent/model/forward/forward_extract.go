package forward

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var segRe = regexp.MustCompile(`^([^\[\]]+)((?:\[\d+\])*)$`)
var idxRe = regexp.MustCompile(`\[\d+\]`)

// ExtractPath 按点路径从解析后的 JSON 取值：
//
//	reply / data.text / choices[0].message.content / data.items[0].content
//
// 命中的值必须是 string / json.Number / float64；nil 或复合类型报错。
// 报错要带失败段位置——配置写错是这条路上最常见的故障。
func ExtractPath(root any, path string) (string, error) {
	cur := root
	for _, seg := range strings.Split(path, ".") {
		if seg == "" {
			return "", fmt.Errorf("路径 %q 有空段", path)
		}
		m := segRe.FindStringSubmatch(seg)
		if m == nil {
			return "", fmt.Errorf("路径 %q 的段 %q 非法", path, seg)
		}
		key := m[1]
		obj, ok := cur.(map[string]any)
		if !ok {
			return "", fmt.Errorf("路径 %q 在 %q 处命中非对象（实际类型 %T）", path, key, cur)
		}
		cur, ok = obj[key]
		if !ok {
			return "", fmt.Errorf("路径 %q 未命中：%q 不存在", path, key)
		}
		for _, idxStr := range idxRe.FindAllString(m[2], -1) {
			idx, _ := strconv.Atoi(strings.Trim(idxStr, "[]"))
			arr, ok := cur.([]any)
			if !ok {
				return "", fmt.Errorf("路径 %q 在 %q 处命中非数组（实际类型 %T）", path, key, cur)
			}
			if idx >= len(arr) {
				return "", fmt.Errorf("路径 %q 在 %q[%d] 处越界（长度 %d）", path, key, idx, len(arr))
			}
			cur = arr[idx]
		}
	}
	switch v := cur.(type) {
	case string:
		return v, nil
	case json.Number:
		return v.String(), nil
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), nil
	case nil:
		return "", fmt.Errorf("路径 %q 命中 null", path)
	default:
		return "", fmt.Errorf("路径 %q 命中非文本值（实际类型 %T），检查 text_path", path, cur)
	}
}

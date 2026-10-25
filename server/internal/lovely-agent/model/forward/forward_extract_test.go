package forward

import (
	"encoding/json"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, s string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestExtractPathForms(t *testing.T) {
	root := mustJSON(t, `{"reply":"ok","data":{"text":"嵌套","items":[{"content":"数组"}]},"num":42}`)
	cases := map[string]string{
		"reply":                 "ok",
		"data.text":             "嵌套",
		"data.items[0].content": "数组",
	}
	for path, want := range cases {
		got, err := ExtractPath(root, path)
		if err != nil || got != want {
			t.Fatalf("%s = %q, %v; want %q", path, got, err, want)
		}
	}
	if got, err := ExtractPath(root, "num"); err != nil || got != "42" {
		t.Fatalf("数字应转字符串: %q %v", got, err)
	}
}

func TestExtractPathErrors(t *testing.T) {
	root := mustJSON(t, `{"a":{"b":null},"arr":[1]}`)
	for name, tc := range map[string]struct{ path, frag string }{
		"缺键":      {"a.c", "不存在"},
		"命中 null": {"a.b", "null"},
		"命中对象":    {"a", "非文本"},
		"越界":      {"arr[3]", "越界"},
		"非法段":     {"a..b", "空段"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ExtractPath(root, tc.path)
			if err == nil || !strings.Contains(err.Error(), tc.frag) {
				t.Fatalf("err = %v; 应含 %q", err, tc.frag)
			}
		})
	}
}

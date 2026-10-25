package forward

import (
	"encoding/json"
	"strings"
	"testing"
)

const minSpec = `{
  "request": {"url": "http://127.0.0.1:3100/api/chat", "method": "POST", "body": {"text": "{{last_user}}"}},
  "response": {"type": "json", "text_path": "reply"}
}`

func TestParseForwardSpecDefaults(t *testing.T) {
	spec, err := ParseForwardSpec(json.RawMessage(minSpec))
	if err != nil {
		t.Fatal(err)
	}
	if spec.Version != 1 || spec.Request.TimeoutMS != 120000 {
		t.Fatalf("version/timeout 默认值错误: %+v", spec.Request)
	}
	if spec.Options.SessionID != "default" || spec.Options.MockStreamChunk != 12 || spec.Options.MockStreamDelayMS != 20 {
		t.Fatalf("options 默认值错误: %+v", spec.Options)
	}
	for name, v := range map[string]*bool{
		"include_system": spec.Options.IncludeSystem, "include_history": spec.Options.IncludeHistory,
		"mock_stream": spec.Options.MockStream,
	} {
		if v == nil || !*v {
			t.Fatalf("%s 默认应为 true", name)
		}
	}
	if spec.Probe != nil {
		t.Fatal("probe 默认应为 nil")
	}
}

func TestParseForwardSpecExplicitFalse(t *testing.T) {
	raw := `{
	  "request": {"url": "http://127.0.0.1:3100/x", "method": "GET"},
	  "response": {"type": "text"},
	  "options": {"include_system": false, "mock_stream": false}
	}`
	spec, err := ParseForwardSpec(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	if *spec.Options.IncludeSystem || *spec.Options.MockStream {
		t.Fatal("显式 false 被默认值覆盖（*bool 三态失效）")
	}
}

func TestParseForwardSpecProbeDefaults(t *testing.T) {
	raw := `{
	  "request": {"url": "http://127.0.0.1:1/x", "method": "GET"},
	  "response": {"type": "text"},
	  "probe": {"url": "http://127.0.0.1:1/status"}
	}`
	spec, err := ParseForwardSpec(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	if spec.Probe.Method != "GET" || spec.Probe.ExpectStatus != 200 {
		t.Fatalf("probe 默认值错误: %+v", spec.Probe)
	}
}

func TestParseForwardSpecErrors(t *testing.T) {
	cases := map[string]string{
		"空配置":              ``,
		"版本不支持":            `{"version": 2}`,
		"缺 url":            `{"request": {"method": "POST"}, "response": {"type": "text"}}`,
		"坏 method":         `{"request": {"url": "http://127.0.0.1:1/x", "method": "PATCH"}, "response": {"type": "text"}}`,
		"外网 http":          `{"request": {"url": "http://example.com/x", "method": "GET"}, "response": {"type": "text"}}`,
		"缺 type":           `{"request": {"url": "http://127.0.0.1:1/x", "method": "GET"}}`,
		"json 缺 text_path": `{"request": {"url": "http://127.0.0.1:1/x", "method": "GET"}, "response": {"type": "json"}}`,
		"未知占位符":            `{"request": {"url": "http://127.0.0.1:1/x", "method": "GET", "body": {"t": "{{nope}}"}}, "response": {"type": "text"}}`,
		"chunk 为负":         `{"request": {"url": "http://127.0.0.1:1/x", "method": "GET"}, "response": {"type": "text"}, "options": {"mock_stream_chunk": -1}}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseForwardSpec(json.RawMessage(raw)); err == nil {
				t.Fatalf("%s 应报错", name)
			}
		})
	}
	// 坏 JSON 的报错要带行号
	_, err := ParseForwardSpec(json.RawMessage("{\n \"request\": {"))
	if err == nil || !strings.Contains(err.Error(), "第 2 行") {
		t.Fatalf("坏 JSON 报错应带行号: %v", err)
	}
}

func TestUsesPlaceholder(t *testing.T) {
	raw := json.RawMessage(`{"request": {"url": "http://127.0.0.1:1/x", "method": "GET", "body": {"t": "{{ model }}"}}, "response": {"type": "text"}}`)
	if !UsesPlaceholder(raw, "model") {
		t.Fatal("{{ model }}（带空格）应被识别")
	}
	if UsesPlaceholder(raw, "last_user") {
		t.Fatal("不存在的占位符不应命中")
	}
}

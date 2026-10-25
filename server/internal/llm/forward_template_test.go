package llm

import (
	"encoding/json"
	"testing"

	"lovelybuddy/server/internal/lovely-agent/model"
)

func ctxFor(t *testing.T) placeholderCtx {
	t.Helper()
	return placeholderCtx{
		LastUser: "你好", System: "你是桌宠",
		Messages: []model.Message{{Role: "system", Content: "你是桌宠"}, {Role: "user", Content: "你好"}},
		History:  []model.Message{{Role: "assistant", Content: "既往回复"}},
		Model:    "m1", SessionID: "pet", Now: "123",
	}
}

func TestRenderWholePlaceholderRawType(t *testing.T) {
	body := map[string]any{"messages": "{{messages}}"}
	out, err := renderBody(body, ctxFor(t))
	if err != nil {
		t.Fatal(err)
	}
	msgs, ok := out.(map[string]any)["messages"].([]model.Message)
	if !ok || len(msgs) != 2 {
		t.Fatalf("整串占位符应渲染为原始 []Message: %#v", out)
	}
	raw, _ := json.Marshal(msgs)
	if string(raw) != `[{"role":"system","content":"你是桌宠"},{"role":"user","content":"你好"}]` {
		t.Fatalf("[]Message 序列化形状错误: %s", raw)
	}
}

func TestRenderEmbeddedPlaceholderConcat(t *testing.T) {
	out, err := renderString("用户说：{{last_user}}", ctxFor(t))
	if err != nil || out != "用户说：你好" {
		t.Fatalf("嵌入拼接错误: %v %v", out, err)
	}
}

func TestRenderEnvPlaceholder(t *testing.T) {
	t.Setenv("LB_TEST_TOKEN", "tk-1")
	out, err := renderString("{{env:LB_TEST_TOKEN}}", ctxFor(t))
	if err != nil || out != "tk-1" {
		t.Fatalf("env 占位符错误: %v %v", out, err)
	}
}

func TestRenderUnknownPlaceholderErrors(t *testing.T) {
	if _, err := renderString("{{nope}}", ctxFor(t)); err == nil {
		t.Fatal("未知名应报错")
	}
	if _, err := renderString("前缀{{nope}}后缀", ctxFor(t)); err == nil {
		t.Fatal("嵌入未知名应报错")
	}
}

func TestRenderMapKeyNotRendered(t *testing.T) {
	out, err := renderBody(map[string]any{"{{last_user}}": "v"}, ctxFor(t))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := out.(map[string]any)["{{last_user}}"]; !ok {
		t.Fatal("map 键不应被渲染")
	}
}

func TestRenderEmbeddedRawTypeErrors(t *testing.T) {
	if _, err := renderString("历史：{{messages}}", ctxFor(t)); err == nil {
		t.Fatal("嵌入数组占位符应报错")
	}
}

func TestRenderNestedArray(t *testing.T) {
	body := map[string]any{"list": []any{"a{{last_user}}", "{{system}}"}}
	out, err := renderBody(body, ctxFor(t))
	if err != nil {
		t.Fatal(err)
	}
	list := out.(map[string]any)["list"].([]any)
	if list[0] != "a你好" || list[1] != "你是桌宠" {
		t.Fatalf("嵌套数组渲染错误: %#v", list)
	}
}

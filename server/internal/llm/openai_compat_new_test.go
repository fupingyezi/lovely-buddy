package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestNewExplicitKeyAndMaxTokens：New() 显式注入 key、maxTokens 进入请求体。
func TestNewExplicitKeyAndMaxTokens(t *testing.T) {
	var gotAuth, gotModel string
	var gotMax int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		var req map[string]any
		_ = json.Unmarshal(body, &req)
		gotModel, _ = req["model"].(string)
		if v, ok := req["max_tokens"].(float64); ok {
			gotMax = int(v)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(srv.Close)

	p, err := New("moonshot", "moonshot-v1-8k", srv.URL, "sk-test-key", 512)
	if err != nil {
		t.Fatal(err)
	}
	if !p.Configured() || p.KeyEnv() != "MOONSHOT_API_KEY" {
		t.Fatalf("Configured/KeyEnv 异常: %v %v", p.Configured(), p.KeyEnv())
	}
	for ev := range p.StreamChat(context.Background(), []Message{{Role: "user", Content: "hi"}}) {
		if ev.Err != nil {
			t.Fatalf("流错误: %v", ev.Err)
		}
	}
	if gotAuth != "Bearer sk-test-key" {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	if gotModel != "moonshot-v1-8k" || gotMax != 512 {
		t.Fatalf("model=%q max_tokens=%d", gotModel, gotMax)
	}
}

func TestNewUnknownProviderErrors(t *testing.T) {
	if _, err := New("nope", "", "", "k", 0); err == nil {
		t.Fatal("未知厂商应报错")
	}
}

func TestNewDefaults(t *testing.T) {
	p, err := New("zhipu", "", "", "k", 0)
	if err != nil {
		t.Fatal(err)
	}
	if p.model != "glm-4-flash" {
		t.Fatalf("默认模型 = %q", p.model)
	}
}

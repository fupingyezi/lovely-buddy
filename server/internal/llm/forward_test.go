package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"lovelybuddy/server/internal/lovely-agent/model"
)

// forwardSpec 造一个指向指定 URL 的 json 类型 provider：chunk 2、延迟 0（测试快）。
func forwardSpec(t *testing.T, url string) *ForwardProvider {
	t.Helper()
	raw := fmt.Sprintf(`{
	  "request": {"url": "%s", "method": "POST",
	    "body": {"text": "{{last_user}}", "system": "{{system}}", "messages": "{{messages}}"},
	    "timeout_ms": 5000},
	  "response": {"type": "json", "text_path": "reply"},
	  "options": {"mock_stream_chunk": 2, "mock_stream_delay_ms": 0}
	}`, url)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func collect(t *testing.T, p *ForwardProvider, msgs []model.Message) (string, []string) {
	t.Helper()
	var deltas []string
	for ev := range p.StreamChat(context.Background(), msgs) {
		if ev.Err != nil {
			t.Fatalf("流错误: %v", ev.Err)
		}
		deltas = append(deltas, ev.Delta)
	}
	return strings.Join(deltas, ""), deltas
}

func TestForwardJSONChunkedChinese(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"reply":"你好世界"}`)
	}))
	t.Cleanup(srv.Close)
	full, deltas := collect(t, forwardSpec(t, srv.URL), []model.Message{{Role: "user", Content: "hi"}})
	if full != "你好世界" || len(deltas) != 2 {
		t.Fatalf("full=%q deltas=%v; 期望按 rune 切 2 段不乱码", full, deltas)
	}
}

func TestForwardTextTypeNoMockStream(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "纯文本回复")
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{"request": {"url": "%s", "method": "GET"}, "response": {"type": "text"}, "options": {"mock_stream": false}}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	full, deltas := collect(t, p, []model.Message{{Role: "user", Content: "hi"}})
	if full != "纯文本回复" || len(deltas) != 1 {
		t.Fatalf("mock_stream=false 应整段一次推: %q %v", full, deltas)
	}
}

func TestForwardNDJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "{\"reply\":\"第一段\"}\n{\"reply\":\"第二段\"}\n")
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{"request": {"url": "%s", "method": "GET"}, "response": {"type": "ndjson", "text_path": "reply"}}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	full, deltas := collect(t, p, []model.Message{{Role: "user", Content: "hi"}})
	if full != "第一段第二段" || len(deltas) != 2 {
		t.Fatalf("ndjson 应每行一段: %q %v", full, deltas)
	}
}

func TestForwardSSEOpenAI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{"request": {"url": "%s", "method": "GET"}, "response": {"type": "sse_openai"}}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	full, deltas := collect(t, p, []model.Message{{Role: "user", Content: "hi"}})
	if full != "你好" || len(deltas) != 2 {
		t.Fatalf("sse_openai 应逐 delta 推: %q %v", full, deltas)
	}
}

func TestForwardIncludeSystemFalse(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		fmt.Fprint(w, `{"reply":"ok"}`)
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{
	  "request": {"url": "%s", "method": "POST", "body": {"system": "{{system}}", "messages": "{{messages}}"}, "timeout_ms": 5000},
	  "response": {"type": "json", "text_path": "reply"},
	  "options": {"include_system": false, "mock_stream": false}
	}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	msgs := []model.Message{{Role: "system", Content: "人设"}, {Role: "user", Content: "hi"}}
	if full, _ := collect(t, p, msgs); full != "ok" {
		t.Fatalf("回复应为 ok: %q", full)
	}
	var body map[string]any
	_ = json.Unmarshal(gotBody, &body)
	if body["system"] != "" {
		t.Fatalf("include_system=false 时 {{system}} 应为空串: %#v", body["system"])
	}
	msgsArr, ok := body["messages"].([]any)
	if !ok || len(msgsArr) != 1 || msgsArr[0].(map[string]any)["role"] != "user" {
		t.Fatalf("{{messages}} 不应含 system 条目: %#v", body["messages"])
	}
}

func TestForwardIncludeHistoryFalse(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		fmt.Fprint(w, `{"reply":"ok"}`)
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{
	  "request": {"url": "%s", "method": "POST", "body": {"history": "{{history}}", "last_user": "{{last_user}}"}, "timeout_ms": 5000},
	  "response": {"type": "json", "text_path": "reply"},
	  "options": {"include_history": false, "mock_stream": false}
	}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	msgs := []model.Message{
		{Role: "system", Content: "人设"}, {Role: "user", Content: "第一句"},
		{Role: "assistant", Content: "回复"}, {Role: "user", Content: "第二句"},
	}
	if full, _ := collect(t, p, msgs); full != "ok" {
		t.Fatalf("回复应为 ok: %q", full)
	}
	var body map[string]any
	_ = json.Unmarshal(gotBody, &body)
	if body["last_user"] != "第二句" {
		t.Fatalf("last_user 应为最后一条 user: %#v", body["last_user"])
	}
	if hist, ok := body["history"].([]any); !ok || len(hist) != 0 {
		t.Fatalf("include_history=false 时 {{history}} 应为空数组: %#v", body["history"])
	}
}

func TestForwardNon2xxErrorPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		fmt.Fprint(w, `{"error":{"message":"内部炸了"}}`)
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{"request": {"url": "%s", "method": "GET"}, "response": {"type": "json", "text_path": "reply", "error_path": "error.message"}}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	var gotErr error
	for ev := range p.StreamChat(context.Background(), []model.Message{{Role: "user", Content: "hi"}}) {
		if ev.Err != nil {
			gotErr = ev.Err
		}
	}
	if gotErr == nil || !strings.Contains(gotErr.Error(), "内部炸了") {
		t.Fatalf("应抠出 error_path 文案: %v", gotErr)
	}
}

func TestForwardCtxCancelStops(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"reply":"这是一段足够长的回复用来测试取消即时生效"}`)
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{
	  "request": {"url": "%s", "method": "GET"},
	  "response": {"type": "json", "text_path": "reply"},
	  "options": {"mock_stream_chunk": 1, "mock_stream_delay_ms": 100}
	}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	ch := p.StreamChat(ctx, []model.Message{{Role: "user", Content: "hi"}})
	<-ch // 收第一块后取消
	cancel()
	done := make(chan struct{})
	go func() {
		for range ch {
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("ctx 取消后 500ms 内应关闭通道")
	}
}

func TestForwardArrayPlaceholderInHeaderFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"reply":"你好"}`)
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{"request": {"url": "%s", "method": "POST",
	  "headers": {"x-arr": "{{messages}}"}, "body": {"text": "{{last_user}}"},
	  "timeout_ms": 5000}, "response": {"type": "json", "text_path": "reply"},
	  "options": {"mock_stream_chunk": 2, "mock_stream_delay_ms": 0}}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	for ev := range p.StreamChat(context.Background(), []model.Message{{Role: "user", Content: "hi"}}) {
		if ev.Err == nil || !strings.Contains(ev.Err.Error(), "不是字符串") {
			t.Fatalf("数组占位符进 header 应报错且不 panic，收到 %v", ev)
		}
		return
	}
	t.Fatal("应至少收到一个错误事件")
}

// TestForwardQuerySecretNotInError 回归：query 里 {{env:NAME}} 渲染出的密钥不得随 *url.Error
// 的完整 URL 进入错误串（后端不可达时错误会直接进聊天气泡）。
func TestForwardQuerySecretNotInError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close() // 关闭后请求快速 connection refused
	t.Setenv("LB_TEST_SECRET", "s3cr3t-v4lue")
	raw := fmt.Sprintf(`{
	  "request": {"url": "http://%s/api", "method": "POST",
	    "query": {"token": "{{env:LB_TEST_SECRET}}"},
	    "body": {"text": "{{last_user}}"}, "timeout_ms": 5000},
	  "response": {"type": "json", "text_path": "reply"}
	}`, addr)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	var errs []string
	for ev := range p.StreamChat(context.Background(), []model.Message{{Role: "user", Content: "hi"}}) {
		if ev.Err != nil {
			errs = append(errs, ev.Err.Error())
		}
	}
	if len(errs) == 0 {
		t.Fatal("应至少收到一个错误事件")
	}
	joined := strings.Join(errs, "\n")
	if strings.Contains(joined, "s3cr3t-v4lue") {
		t.Fatalf("错误串泄漏 query 中已渲染的密钥: %s", joined)
	}
	if !strings.Contains(joined, "转发失败") {
		t.Fatalf("错误串应含「转发失败」: %s", joined)
	}
}

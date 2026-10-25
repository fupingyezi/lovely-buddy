package model

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// fakeUpstream 模拟 OpenAI 兼容 SSE 端点：校验鉴权头后按 script 逐段吐 delta。
func fakeUpstream(t *testing.T, chunks []string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		for _, c := range chunks {
			_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":" + quote(c) + "}}]}\n\n"))
			fl.Flush()
		}
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
		fl.Flush()
	}))
	t.Cleanup(srv.Close)
	return srv
}

func quote(s string) string {
	// 测试 chunk 不含引号/转义，直接拼 JSON 字符串
	return "\"" + s + "\""
}

func TestResolveUnknownProvider(t *testing.T) {
	if _, err := Resolve("nope", "", ""); err == nil {
		t.Fatal("未知厂商应报错")
	}
}

func TestResolveDefaults(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "test-key")
	p, err := Resolve("", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !p.Configured() || p.KeyEnv() != "DEEPSEEK_API_KEY" {
		t.Fatalf("Configured=%v KeyEnv=%s", p.Configured(), p.KeyEnv())
	}
}

func TestStreamChatDeltas(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "test-key")
	up := fakeUpstream(t, []string{"你", "好", "呀"})
	p, err := Resolve("deepseek", "", up.URL) // BaseURL 覆盖指向假上游
	if err != nil {
		t.Fatal(err)
	}

	var got []string
	for ev := range p.StreamChat(context.Background(), []Message{{Role: "user", Content: "hi"}}) {
		if ev.Err != nil {
			t.Fatalf("unexpected err: %v", ev.Err)
		}
		got = append(got, ev.Delta)
	}
	if len(got) != 3 || got[0] != "你" || got[2] != "呀" {
		t.Fatalf("deltas=%v", got)
	}
}

func TestStreamChatCtxCancelClosesChannel(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "test-key")
	block := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"一\"}}]}\n\n"))
		fl.Flush()
		<-block // 挂住第二段，等客户端取消
	}))
	t.Cleanup(func() { close(block); srv.Close() })

	p, err := Resolve("deepseek", "", srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	ch := p.StreamChat(ctx, []Message{{Role: "user", Content: "hi"}})
	if (<-ch).Delta != "一" {
		t.Fatal("第一段应到达")
	}
	cancel()
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatal("取消后通道应直接关闭，不应再有事件")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("取消后 2s 内通道应关闭")
	}
}

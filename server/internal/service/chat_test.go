package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lovelybuddy/server/internal/llm"
)

// scriptedProvider 按脚本回放的假 ChatProvider，并捕获收到的消息（验 persona/prompt）。
type scriptedProvider struct {
	key   bool
	calls [][]llm.Message
	run   func(ctx context.Context, out chan<- llm.StreamEvent)
}

func (p *scriptedProvider) StreamChat(ctx context.Context, msgs []llm.Message) <-chan llm.StreamEvent {
	p.calls = append(p.calls, msgs)
	ch := make(chan llm.StreamEvent)
	go func() {
		defer close(ch)
		p.run(ctx, ch)
	}()
	return ch
}
func (p *scriptedProvider) Configured() bool { return p.key }
func (p *scriptedProvider) KeyEnv() string   { return "DEEPSEEK_API_KEY" }

func send(ch chan<- llm.StreamEvent, deltas ...string) {
	for _, d := range deltas {
		ch <- llm.StreamEvent{Delta: d}
	}
}

func collect(ch <-chan Event) []Event {
	var evs []Event
	for ev := range ch {
		evs = append(evs, ev)
	}
	return evs
}

func types(evs []Event) string {
	s := ""
	for _, e := range evs {
		s += e.Type + ","
	}
	return s
}

func TestStreamNoKey(t *testing.T) {
	store := NewMemStore()
	s := NewChatService(store, &scriptedProvider{}, t.TempDir())
	evs := collect(s.Stream(context.Background(), "", "你好"))
	if len(evs) != 1 || evs[0].Type != "error" || !strings.Contains(evs[0].Error, "DEEPSEEK_API_KEY") {
		t.Fatalf("evs=%+v", evs)
	}
	if msgs, _ := store.History(context.Background(), mustSession(t, store), 10); len(msgs) != 0 {
		t.Fatal("未配 key 不应落库")
	}
}

func mustSession(t *testing.T, store ChatStore) string {
	t.Helper()
	id, err := store.DefaultSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestStreamHappyPath(t *testing.T) {
	store := NewMemStore()
	p := &scriptedProvider{key: true, run: func(_ context.Context, out chan<- llm.StreamEvent) {
		send(out, "你好", "[motion:hap", "py]呀")
	}}
	s := NewChatService(store, p, t.TempDir())

	evs := collect(s.Stream(context.Background(), "", "嗨"))
	if got := types(evs); got != "meta,delta,motion,delta,done," {
		t.Fatalf("事件序=%s evs=%+v", got, evs)
	}
	if evs[1].Text != "你好" || evs[3].Text != "呀" {
		t.Fatalf("delta 不符: %+v", evs)
	}
	last := evs[len(evs)-1]
	if last.Type != "done" || last.Text != "你好呀" || last.Motion != "happy" {
		t.Fatalf("done 不符: %+v", last)
	}
	// 库里：user + assistant（干净文本 + motion）
	msgs, _ := store.History(context.Background(), mustSession(t, store), 10)
	if len(msgs) != 2 || msgs[0].Content != "嗨" || msgs[1].Content != "你好呀" || msgs[1].Motion != "happy" {
		t.Fatalf("落库不符: %+v", msgs)
	}
	// prompt：system 开头含默认人设 + 动作协议，末条是用户输入
	if len(p.calls) != 1 {
		t.Fatalf("provider 调用 %d 次", len(p.calls))
	}
	call := p.calls[0]
	if call[0].Role != "system" || !strings.Contains(call[0].Content, "[motion:") {
		t.Fatalf("system prompt 不符: %q", call[0].Content)
	}
	if call[len(call)-1].Content != "嗨" {
		t.Fatalf("末条应为用户输入: %+v", call[len(call)-1])
	}
}

func TestStreamPersonaFromAvatar(t *testing.T) {
	dir := t.TempDir()
	if err := osWriteFiles(dir, map[string]string{
		"haru/avatar.json": `{"persona":"p.txt"}`,
		"haru/p.txt":       "你是猫。",
	}); err != nil {
		t.Fatal(err)
	}
	store := NewMemStore()
	p := &scriptedProvider{key: true, run: func(_ context.Context, out chan<- llm.StreamEvent) {}}
	s := NewChatService(store, p, dir)
	collect(s.Stream(context.Background(), "haru", "喵"))
	if !strings.HasPrefix(p.calls[0][0].Content, "你是猫。") {
		t.Fatalf("avatar persona 应注入 system 开头: %q", p.calls[0][0].Content)
	}
}

func TestStreamStopPersistsPartial(t *testing.T) {
	store := NewMemStore()
	p := &scriptedProvider{key: true, run: func(ctx context.Context, out chan<- llm.StreamEvent) {
		send(out, "已经说到一半")
		<-ctx.Done() // 用户停止后上游才断
	}}
	s := NewChatService(store, p, t.TempDir())

	ctx, cancel := context.WithCancel(context.Background())
	ch := s.Stream(ctx, "", "长问题")
	var evs []Event
	for ev := range ch {
		evs = append(evs, ev)
		if ev.Type == "delta" {
			cancel() // 收到第一段就停
		}
	}
	last := evs[len(evs)-1]
	if last.Type != "done" || last.Text != "已经说到一半" {
		t.Fatalf("停止应发 done（半截）: %+v", last)
	}
	msgs, _ := store.History(context.Background(), mustSession(t, store), 10)
	if len(msgs) != 2 || msgs[1].Content != "已经说到一半" {
		t.Fatalf("半截内容应落库: %+v", msgs)
	}
}

func TestStreamUpstreamErrorPersistsPartial(t *testing.T) {
	store := NewMemStore()
	p := &scriptedProvider{key: true, run: func(_ context.Context, out chan<- llm.StreamEvent) {
		send(out, "半截")
		out <- llm.StreamEvent{Err: context.DeadlineExceeded}
	}}
	s := NewChatService(store, p, t.TempDir())

	evs := collect(s.Stream(context.Background(), "", "hi"))
	if types(evs) != "meta,delta,error," {
		t.Fatalf("事件序=%s", types(evs))
	}
	msgs, _ := store.History(context.Background(), mustSession(t, store), 10)
	if len(msgs) != 2 || msgs[1].Content != "半截" {
		t.Fatalf("上游失败时已有内容应落库: %+v", msgs)
	}
}

func osWriteFiles(root string, files map[string]string) error {
	for rel, content := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			return err
		}
	}
	return nil
}

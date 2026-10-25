package agent

import (
	"context"
	"strings"
	"testing"

	"lovelybuddy/server/internal/lovely-agent/model"
)

// scriptedProvider 按脚本回放的假 ChatProvider。
type scriptedProvider struct {
	configured bool
	keyEnv     string
	run        func(ctx context.Context, out chan<- model.StreamEvent)
}

func (p *scriptedProvider) StreamChat(ctx context.Context, _ []model.Message) <-chan model.StreamEvent {
	ch := make(chan model.StreamEvent)
	go func() {
		defer close(ch)
		p.run(ctx, ch)
	}()
	return ch
}
func (p *scriptedProvider) Configured() bool { return p.configured }
func (p *scriptedProvider) KeyEnv() string   { return p.keyEnv }

func testConfig() ContextConfig {
	return ContextConfig{
		SystemPrompt:  func(persona string) string { return persona },
		PersonaLoader: func(string) (string, bool) { return "", false },
		History:       func() []model.Message { return nil },
		HistoryLimit:  20,
	}
}

func TestLoopRunHappyPath(t *testing.T) {
	p := &scriptedProvider{configured: true, run: func(_ context.Context, out chan<- model.StreamEvent) {
		out <- model.StreamEvent{Delta: "你好"}
		out <- model.StreamEvent{Delta: "呀"}
	}}
	loop := NewLoop(p, testConfig())
	var deltas []string
	for ev := range loop.Run(context.Background(), "", "hi") {
		if ev.Err != nil {
			t.Fatalf("不应有 Err: %v", ev.Err)
		}
		deltas = append(deltas, ev.Delta)
	}
	if len(deltas) != 2 || deltas[0] != "你好" || deltas[1] != "呀" {
		t.Fatalf("deltas=%v", deltas)
	}
}

func TestLoopRunNotConfigured(t *testing.T) {
	p := &scriptedProvider{configured: false, keyEnv: "DEEPSEEK_API_KEY"}
	loop := NewLoop(p, testConfig())
	var evs []LoopEvent
	for ev := range loop.Run(context.Background(), "", "hi") {
		evs = append(evs, ev)
	}
	if len(evs) != 1 || evs[0].Err == nil || !strings.Contains(evs[0].Err.Error(), "DEEPSEEK_API_KEY") {
		t.Fatalf("未配 key 应仅一条含 KeyEnv 的 Err: %+v", evs)
	}
}

func TestLoopRunUpstreamError(t *testing.T) {
	p := &scriptedProvider{configured: true, run: func(_ context.Context, out chan<- model.StreamEvent) {
		out <- model.StreamEvent{Delta: "半截"}
		out <- model.StreamEvent{Err: context.DeadlineExceeded}
	}}
	loop := NewLoop(p, testConfig())
	var evs []LoopEvent
	for ev := range loop.Run(context.Background(), "", "hi") {
		evs = append(evs, ev)
	}
	if len(evs) != 2 || evs[1].Err == nil || !strings.Contains(evs[1].Err.Error(), "模型调用失败") {
		t.Fatalf("上游失败应包装 模型调用失败: %+v", evs)
	}
}

func TestLoopRunCancelSilent(t *testing.T) {
	p := &scriptedProvider{configured: true, run: func(ctx context.Context, out chan<- model.StreamEvent) {
		out <- model.StreamEvent{Delta: "已经说到一半"}
		<-ctx.Done() // 停止后上游才断（与 service/chat_test 的假 provider 同构）
	}}
	loop := NewLoop(p, testConfig())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var evs []LoopEvent
	for ev := range loop.Run(ctx, "", "长问题") {
		evs = append(evs, ev)
		cancel()
	}
	if len(evs) != 1 || evs[0].Delta != "已经说到一半" {
		t.Fatalf("取消后应静默关闭: %+v", evs)
	}
}

package agent

import (
	"context"
	"fmt"

	"lovelybuddy/server/internal/lovely-agent/model"
)

// Loop 一次对话的编排（单轮直通版）：构建上下文 → 一次 StreamChat → 事件流。
// 工具循环随扩展层功能加入（harness 设计 §4.3）；本版与迁移前行为逐字节一致。
type Loop struct {
	provider model.ChatProvider
	cfg      ContextConfig
}

// NewLoop 组装。provider 在对话发起时捕获（热切换不影响进行中的回复）。
func NewLoop(provider model.ChatProvider, cfg ContextConfig) *Loop {
	return &Loop{provider: provider, cfg: cfg}
}

// Run 单轮直通：未配 key → 仅 Err 事件；否则 Build → StreamChat → 转发 delta。
// 上游失败经 Err 事件（通道随后关闭）；ctx 取消时 provider 停止推送，通道静默关闭（模型层契约）。
func (l *Loop) Run(ctx context.Context, avatarSlug, userText string) <-chan LoopEvent {
	ch := make(chan LoopEvent)
	go func() {
		defer close(ch)
		if !l.provider.Configured() {
			ch <- LoopEvent{Err: fmt.Errorf("未配置 API key：请在设置·模型与连接中添加连接，或在 .env 填写 %s", l.provider.KeyEnv())}
			return
		}
		msgs := Build(ctx, l.cfg, avatarSlug, userText)
		for ev := range l.provider.StreamChat(ctx, msgs) {
			if ev.Err != nil {
				ch <- LoopEvent{Err: fmt.Errorf("模型调用失败: %w", ev.Err)}
				return
			}
			ch <- LoopEvent{Delta: ev.Delta}
		}
	}()
	return ch
}

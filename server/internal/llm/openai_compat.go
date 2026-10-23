package llm

import (
	"context"
	"errors"
	"io"
	"os"

	openai "github.com/sashabaranov/go-openai"
)

// OpenAICompat 唯一实现：go-openai 改 BaseURL 指向任意 OpenAI 兼容端点。
type OpenAICompat struct {
	client *openai.Client
	model  string
	key    string
	keyEnv string
}

// Resolve 按配置实例化。provider 空 = deepseek；model 空 = 厂商默认；baseURLOverride 非空覆盖。
// 未知厂商名报错——配置拼写错误应启动即失败，而不是聊天时才报。
func Resolve(provider, model, baseURLOverride string) (*OpenAICompat, error) {
	if provider == "" {
		provider = "deepseek"
	}
	spec, ok := Providers[provider]
	if !ok {
		return nil, errors.New("未知对话厂商: " + provider + "（可选: deepseek, dashscope）")
	}
	if model == "" {
		model = spec.DefaultModel
	}
	if baseURLOverride == "" {
		baseURLOverride = spec.BaseURL
	}
	cfg := openai.DefaultConfig(os.Getenv(spec.APIKeyEnv))
	cfg.BaseURL = baseURLOverride
	return &OpenAICompat{
		client: openai.NewClientWithConfig(cfg),
		model:  model,
		key:    os.Getenv(spec.APIKeyEnv),
		keyEnv: spec.APIKeyEnv,
	}, nil
}

func (p *OpenAICompat) Configured() bool { return p.key != "" }
func (p *OpenAICompat) KeyEnv() string   { return p.keyEnv }

// StreamChat 建流后逐段转发 delta；ctx 取消时 go-openai 内部请求中断，本协程退出并关闭通道。
func (p *OpenAICompat) StreamChat(ctx context.Context, msgs []Message) <-chan StreamEvent {
	ch := make(chan StreamEvent)
	om := make([]openai.ChatCompletionMessage, len(msgs))
	for i, m := range msgs {
		om[i] = openai.ChatCompletionMessage{Role: m.Role, Content: m.Content}
	}
	go func() {
		defer close(ch)
		stream, err := p.client.CreateChatCompletionStream(ctx, openai.ChatCompletionRequest{
			Model:    p.model,
			Messages: om,
			Stream:   true,
		})
		if err != nil {
			if ctx.Err() == nil {
				ch <- StreamEvent{Err: err}
			}
			return
		}
		defer stream.Close()
		for {
			resp, err := stream.Recv()
			if err != nil {
				if !errors.Is(err, io.EOF) && ctx.Err() == nil {
					ch <- StreamEvent{Err: err}
				}
				return
			}
			if len(resp.Choices) > 0 && resp.Choices[0].Delta.Content != "" {
				select {
				case ch <- StreamEvent{Delta: resp.Choices[0].Delta.Content}:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return ch
}

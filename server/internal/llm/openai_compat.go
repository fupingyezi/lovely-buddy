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
	client    *openai.Client
	model     string
	key       string
	keyEnv    string
	maxTokens int
}

// New 按显式参数实例化（M3 设置界面注入的路径）：key 直接传入而非读 env。
// provider 空 = deepseek；model 空 = 厂商默认；baseURL 空 = 厂商默认地址。
// 未知厂商名报错——配置拼写错误应即刻失败，而不是聊天时才报。
func New(provider, model, baseURL, apiKey string, maxTokens int) (*OpenAICompat, error) {
	if provider == "" {
		provider = "deepseek"
	}
	spec, ok := Providers[provider]
	if !ok {
		return nil, errors.New("未知对话厂商: " + provider + "（可选: deepseek, dashscope, zhipu, moonshot）")
	}
	if model == "" {
		model = spec.DefaultModel
	}
	if baseURL == "" {
		baseURL = spec.BaseURL
	}
	cfg := openai.DefaultConfig(apiKey)
	cfg.BaseURL = baseURL
	return &OpenAICompat{
		client:    openai.NewClientWithConfig(cfg),
		model:     model,
		key:       apiKey,
		keyEnv:    spec.APIKeyEnv,
		maxTokens: maxTokens,
	}, nil
}

// Resolve 按环境配置实例化（env/.env 兜底路径：key 从厂商 APIKeyEnv 读）。
func Resolve(provider, model, baseURLOverride string) (*OpenAICompat, error) {
	if provider == "" {
		provider = "deepseek"
	}
	spec, ok := Providers[provider]
	if !ok {
		return nil, errors.New("未知对话厂商: " + provider + "（可选: deepseek, dashscope, zhipu, moonshot）")
	}
	return New(provider, model, baseURLOverride, os.Getenv(spec.APIKeyEnv), 0)
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
			Model:     p.model,
			Messages:  om,
			Stream:    true,
			MaxTokens: p.maxTokens, // 0 = 不传（上游默认）；测试连接用 1
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

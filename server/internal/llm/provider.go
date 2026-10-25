// Package llm 模型厂商抽象（spec §4）。M2 只有对话；EmbeddingProvider 留给 M5。
package llm

import "context"

// Message 一条对话消息（Role: system | user | assistant）。
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// StreamEvent 流式片段；Err 非 nil 表示上游失败（事件通道随后关闭）。
type StreamEvent struct {
	Delta string
	Err   error
}

// ChatProvider 流式对话抽象。
type ChatProvider interface {
	// StreamChat 发起一次流式补全；通道在结束/出错/ctx 取消后关闭。
	StreamChat(ctx context.Context, msgs []Message) <-chan StreamEvent
	// Configured 是否已配置 API key（调用前据此给出可操作错误，而不是含糊的上游 401）。
	Configured() bool
	// KeyEnv 未配 key 时提示用户填写的环境变量名。
	KeyEnv() string
}

// ProviderSpec 厂商注册表条目（全部 OpenAI 兼容端点）。
type ProviderSpec struct {
	BaseURL      string
	DefaultModel string
	APIKeyEnv    string
}

// Providers 内置厂商（spec §4：DeepSeek/GLM/Qwen/Kimi，全部 OpenAI 兼容端点）。
var Providers = map[string]ProviderSpec{
	"deepseek":  {BaseURL: "https://api.deepseek.com", DefaultModel: "deepseek-chat", APIKeyEnv: "DEEPSEEK_API_KEY"},
	"dashscope": {BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", DefaultModel: "qwen-plus", APIKeyEnv: "DASHSCOPE_API_KEY"},
	"zhipu":     {BaseURL: "https://open.bigmodel.cn/api/paas/v4", DefaultModel: "glm-4-flash", APIKeyEnv: "ZHIPU_API_KEY"},
	"moonshot":  {BaseURL: "https://api.moonshot.cn/v1", DefaultModel: "moonshot-v1-8k", APIKeyEnv: "MOONSHOT_API_KEY"},
}

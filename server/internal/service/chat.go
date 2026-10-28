package service

import (
	"context"
	"strings"

	"lovelybuddy/server/internal/assets"
	"lovelybuddy/server/internal/configstore"
	"lovelybuddy/server/internal/dao"
	"lovelybuddy/server/internal/lovely-agent/agent"
	"lovelybuddy/server/internal/lovely-agent/memory"
	"lovelybuddy/server/internal/lovely-agent/model"
)

// Event SSE 事件（JSON 字段名即线上协议，renderer lib/chatApi.ts 与之对齐）。
type Event struct {
	Type      string `json:"type"`                 // meta | delta | motion | done | error
	SessionID string `json:"session_id,omitempty"` // meta
	Text      string `json:"text,omitempty"`       // delta 增量 / done 完整干净文本
	Intent    string `json:"intent,omitempty"`     // motion
	Motion    string `json:"motion,omitempty"`     // done：最后意图（可空）
	Error     string `json:"error,omitempty"`      // error
}

// historyLimit 每次请求注入的历史条数（prompt 顺序中的「历史」段）。
const historyLimit = 20

type ChatService struct {
	store     ChatStore
	reg       *model.Registry
	modelDir  string
	persona   *PersonaService // 可空：nil = 无自定义人设（内置/默认兜底）
	mem       *MemoryService  // 可空：nil = 不注入记忆段
	modelName func() string   // 可空：nil = {model} 替换为空串
}

// NewChatService 以厂商注册表组装：每次对话从 reg 取当前厂商（M3 设置界面热切换）。
// persona/mem/modelName 为可选接线项，未接时传 nil。
func NewChatService(store ChatStore, reg *model.Registry, modelDir string, persona *PersonaService, mem *MemoryService, modelName func() string) *ChatService {
	return &ChatService{store: store, reg: reg, modelDir: modelDir, persona: persona, mem: mem, modelName: modelName}
}

// History 供 /api/v1/history：默认会话最近 limit 条（升序）。
func (s *ChatService) History(ctx context.Context, limit int) (string, []dao.Message, error) {
	id, err := s.store.DefaultSession(ctx)
	if err != nil {
		return "", nil, err
	}
	msgs, err := s.store.History(ctx, id, limit)
	return id, msgs, err
}

// ClearHistory 清空默认会话全部消息（保留会话行），供 DELETE /api/v1/history。
func (s *ChatService) ClearHistory(ctx context.Context) error {
	id, err := s.store.DefaultSession(ctx)
	if err != nil {
		return err
	}
	return s.store.Clear(ctx, id)
}

// Stream 一次对话全流程（顺序固定，勿改）：
//  1. 未配 API key → 仅 error 事件（不建会话不落库）
//  2. DefaultSession → meta 事件
//  3. 读历史（不含本次输入）→ 落用户消息
//  4. 组装 agent.Loop（单轮直通）→ agent 构建上下文（人设+动作协议 → 历史 → 最新输入）→ provider 流式
//  5. MotionFilter 净化：可见增量发 delta、识别意图发 motion
//  6. 正常结束 Flush；assistant（干净全文 + 最后意图）落库 → done
//  7. ctx 取消（用户停止）：半截内容照常落库后发 done（不算错误）
//  8. 上游失败：已有内容仍落库，最后发 error
func (s *ChatService) Stream(ctx context.Context, avatarSlug, userText string) <-chan Event {
	ch := make(chan Event)
	go func() {
		defer close(ch)
		provider := s.reg.Current() // 对话发起时捕获：切换连接不影响本次回复
		if !provider.Configured() {
			ch <- Event{Type: "error", Error: "未配置 API key：请在设置·模型与连接中添加连接，或在 .env 填写 " + provider.KeyEnv()}
			return
		}
		sessionID, err := s.store.DefaultSession(ctx)
		if err != nil {
			ch <- Event{Type: "error", Error: "会话创建失败: " + err.Error()}
			return
		}
		ch <- Event{Type: "meta", SessionID: sessionID}

		history, err := s.store.History(ctx, sessionID, historyLimit)
		if err != nil {
			ch <- Event{Type: "error", Error: "历史读取失败: " + err.Error()}
			return
		}
		if err := s.store.Append(ctx, sessionID, "user", userText, ""); err != nil {
			ch <- Event{Type: "error", Error: "消息写入失败: " + err.Error()}
			return
		}

		// 组装 harness：历史在落用户消息前已读好并捕获；Loop 不接触 store（记录语义归 service）。
		loop := agent.NewLoop(provider, agent.ContextConfig{
			SystemPrompt: SystemPrompt,
			PersonaLoader: func(slug string) (string, bool) {
				builtin, ok := assets.PersonaText(s.modelDir, slug)
				custom := configstore.Persona{}
				if s.persona != nil {
					custom = s.persona.Custom()
				}
				composed := ComposePersona(builtin, custom)
				if composed == "" {
					return builtin, ok
				}
				var mn string
				if s.modelName != nil {
					mn = s.modelName()
				}
				return expandPersonaVars(composed, mn), true
			},
			History:      func() []model.Message { return toModel(history) },
			HistoryLimit: historyLimit,
			Memory: func(userText string) string {
				if s.mem == nil {
					return ""
				}
				items, err := s.mem.Retrieve(ctx, userText, MemoryInjectLimit)
				if err != nil {
					return "" // 记忆读取失败不阻断对话
				}
				return memory.BuildSegment(items)
			},
		})

		filter := NewMotionFilter()
		var full strings.Builder
		lastMotion := ""
		for ev := range loop.Run(ctx, avatarSlug, userText) {
			if ev.Err != nil {
				s.persistPartial(sessionID, full.String(), lastMotion)
				ch <- Event{Type: "error", Error: ev.Err.Error()}
				return
			}
			visible, motion := filter.Push(ev.Delta)
			if motion != "" {
				lastMotion = motion
				ch <- Event{Type: "motion", Intent: motion}
			}
			if visible != "" {
				full.WriteString(visible)
				ch <- Event{Type: "delta", Text: visible}
			}
		}
		if vis, mot := filter.Flush(); vis != "" || mot != "" {
			if mot != "" {
				lastMotion = mot
				ch <- Event{Type: "motion", Intent: mot}
			}
			if vis != "" {
				full.WriteString(vis)
				ch <- Event{Type: "delta", Text: vis}
			}
		}
		if err := s.store.Append(context.WithoutCancel(ctx), sessionID, "assistant", full.String(), lastMotion); err != nil {
			ch <- Event{Type: "error", Error: "消息写入失败: " + err.Error()}
			return
		}
		ch <- Event{Type: "done", Text: full.String(), Motion: lastMotion}
	}()
	return ch
}

// persistPartial 失败/取消路径的尽力落库（用后台 ctx：请求 ctx 可能已被取消）。
func (s *ChatService) persistPartial(sessionID, content, motion string) {
	if strings.TrimSpace(content) == "" {
		return
	}
	_ = s.store.Append(context.Background(), sessionID, "assistant", content, motion)
}

// toModel dao.Message → model.Message（harness 不 import dao，转换在 service）。
func toModel(msgs []dao.Message) []model.Message {
	out := make([]model.Message, len(msgs))
	for i, m := range msgs {
		out[i] = model.Message{Role: m.Role, Content: m.Content}
	}
	return out
}

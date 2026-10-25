# lovely-agent harness 迁移（步骤 1+2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扁平 `internal/llm` 迁移为 `internal/lovely-agent` harness 分层（model 层 + agent loop 层），service 重组为 Loop 单轮直通入口——**零行为变化**。

**Architecture:** 两步走：Task 1-2 纯包迁移（model 包 + forward 子包，逻辑与测试不变）；Task 3 建 agent 包（Loop 单轮直通 + 上下文构建注入）并把 ChatService 重组为组装层；Task 4 文档路径同步与收尾。

**Tech Stack:** Go 1.27.1（纯包迁移 + 小重构，无新依赖）

**Spec:** `docs/superpowers/specs/2026-10-25-harness-layering-design.md`（§11 步骤 1、2 是本计划的实施范围；步骤 3-7 另立计划）

## Global Constraints

- **零行为变化**：SSE 事件序列（类型/文案/顺序）、落库内容、错误文案与迁移前逐字节一致。回归线 = 现有测试全绿，`service/chat_test.go`、`internal/server/server_test.go` 的断言**一律不改**（只改 import 与类型引用）。
- **forward/openai_compat 逻辑与测试不变**：只改 package 声明、import 路径、类型前缀；测试用例内容（含断言文案）不增删改。
- **骨架裁决**：design §11 步骤 1 的「agent/memory/extension 骨架与接口」**不在本计划**——Tool/ToolRegistry/Memory/SkillProvider 接口与 LoopEvent.ToolStatus/Done 字段随各自功能计划（design §11 步骤 4-6）落地，本计划不建死代码（YAGNI）。
- **依赖硬规则**（design §2.1）：agent 不 import service/db/dao/mcp；wiring 唯一归 service；model 不依赖 harness 内任何层。
- **文档边界**：`docs/design.md` §4 的 forward 表述更新仍由 Task 7 门控（用户视觉验收后），本计划不碰 design.md；历史计划（2026-10-23/24/25 的 plans）是归档记录，不改。
- **工程惯例**：Go 测试与源码同目录；Conventional Commits、subject 小写开头；每任务提交前 `gofmt -l` 干净 + `go vet ./...` + `go test ./... -race` 全绿；直接提交 main。

---

### Task 1: model 包落位（provider/registry/openai_compat 迁移，forward 暂留 llm）

**Files:**
- Move: `server/internal/llm/{provider.go, registry.go, registry_test.go, openai_compat.go, openai_compat_test.go, openai_compat_new_test.go}` → `server/internal/lovely-agent/model/`
- Modify: `server/internal/llm/{forward.go, forward_template.go, forward_template_test.go, forward_test.go}`（引用 model 类型）
- Modify: 全部外部引用方（见 Step 4-6）

**Interfaces:**
- Consumes: 现有 `internal/llm` 包（当前 HEAD 即上一步提交后的 main）
- Produces: `lovelybuddy/server/internal/lovely-agent/model`（ChatProvider/Message/StreamEvent/Providers/New/Resolve/NewRegistry/Registry/OpenAICompat）；forward 文件仍在 `internal/llm`（下一任务迁移）

- [ ] **Step 1: 移动文件并改 package 声明**

```bash
cd server
mkdir -p internal/lovely-agent/model
git mv internal/llm/provider.go internal/llm/registry.go internal/llm/registry_test.go \
       internal/llm/openai_compat.go internal/llm/openai_compat_test.go internal/llm/openai_compat_new_test.go \
       internal/lovely-agent/model/
```

6 个文件首行 `package llm` → `package model`。`provider.go` 的包注释改为：

```go
// Package model 模型层：换脑插槽（harness 设计 docs/superpowers/specs/2026-10-25-harness-layering-design.md）。
// 拿消息流，还流式文本；无状态、无记忆。M2 只有对话；EmbeddingProvider 留给 M5。
package model
```

- [ ] **Step 2: forward 文件引用 model 类型（仍在 llm 包内）**

`server/internal/llm/forward.go`：import 块加 `"lovelybuddy/server/internal/lovely-agent/model"`（标准库后、go-openai 前后均可，保持分组风格），逐行替换：

```go
// :45
func (p *ForwardProvider) StreamChat(ctx context.Context, msgs []model.Message) <-chan model.StreamEvent {
// :46
	ch := make(chan model.StreamEvent)
// :55
				ch <- model.StreamEvent{Err: err}
// :62
				ch <- model.StreamEvent{Err: fmt.Errorf("转发失败: %w", err)}
// :68
			ch <- model.StreamEvent{Err: err}
// :76
func applyOptions(msgs []model.Message, o ForwardOpts) []model.Message {
// :77
	eff := make([]model.Message, 0, len(msgs))
// :85
		out := make([]model.Message, 0, 2)
// :100
func lastUserOf(msgs []model.Message) *model.Message {
// :112
func split(eff []model.Message) (system, lastUser string, history []model.Message) {
// :114
	history = make([]model.Message, 0, len(eff))
// :249
func (p *ForwardProvider) emit(ctx context.Context, resp *http.Response, ch chan<- model.StreamEvent) error {
```

`server/internal/llm/forward_template.go`：import 加 model；替换：

```go
// :15
	Messages  []model.Message
// :16
	History   []model.Message
// :23
func newPlaceholderCtx(sys, lastUser string, eff, history []model.Message, model, sessionID string) placeholderCtx {
```

注意：:23 的形参名 `model` 遮蔽包名只影响函数体（体内用形参值，不引用包），签名处 `[]model.Message` 合法。

`server/internal/llm/forward_template_test.go`：import 加 model；替换：

```go
// :12
		Messages: []model.Message{{Role: "system", Content: "你是桌宠"}, {Role: "user", Content: "你好"}},
// :13
		History:  []model.Message{{Role: "assistant", Content: "既往回复"}},
// :24
	msgs, ok := out.(map[string]any)["messages"].([]model.Message)
```

`server/internal/llm/forward_test.go`：import 加 model；先替换所有 `Message{` → `model.Message{`（覆盖 `[]Message{{Role:` 等复合字面量），再替换剩余的 `[]Message` → `[]model.Message`（:33 `collect` 签名与各 `msgs := []Message{...}`）。替换涉及行：33、51、63、67、79、83、96、100、118、122、153、177、182、207、236、266（以 `grep -n '\[\]Message\|Message{' forward_test.go` 实况为准，必须逐处覆盖）。

- [ ] **Step 3: 验证 llm + model 编译**

Run: `cd server && gofmt -l . && go vet ./... && go test ./... -race`
Expected: 全绿（llm 包只剩 forward 文件 + 引用 model；model 包独立编译通过）

- [ ] **Step 4: 更新外部引用方（model 侧符号）**

`server/cmd/lovely-buddy-server/main.go`：

```go
// :19
	"lovelybuddy/server/internal/llm"          →  "lovelybuddy/server/internal/lovely-agent/model"
// :61
	fallback, err := llm.Resolve(cfg.Chat.Provider, cfg.Chat.Model, cfg.Chat.BaseURL)
	                                    → model.Resolve(...)
// :66
	reg := llm.NewRegistry(fallback)           →  model.NewRegistry(fallback)
```

`server/internal/server/server_test.go`：import llm → model；:26-31 `llm.Message`/`llm.StreamEvent` → `model.`；:42 `llm.NewRegistry` → `model.NewRegistry`。

`server/internal/controller/config_test.go`：import llm → model；:22 `llm.New(` → `model.New(`；:23 `llm.NewRegistry(` → `model.NewRegistry(`。

`server/internal/service/chat.go`：:9 import llm → model；:27 `reg *llm.Registry` → `reg *model.Registry`；:32 NewChatService 签名里的 `reg *llm.Registry` → `reg *model.Registry`。

`server/internal/service/chat_test.go`：import llm → model；文件内全部 `llm.Message`/`llm.StreamEvent`/`llm.NewRegistry` → `model.` 前缀（:16-17、:20、:22、:32、:34、:56、:77、:80、:120-121、:130、:134、:158、:160、:162、:176）。

`server/internal/service/prompt.go`：:8 import llm → model；:29/:33/:34/:36/:38 `llm.Message` → `model.Message`。

`server/internal/service/config.go`：import 块在保留 `"lovelybuddy/server/internal/llm"`（forward 引用仍在本任务后由 Task 2 换掉）的同时新增 `"lovelybuddy/server/internal/lovely-agent/model"`；替换：

```go
// :87
	reg         *llm.Registry          →  *model.Registry
// :88
	fallback    llm.ChatProvider       →  model.ChatProvider
// :92
func NewConfigService(reg *llm.Registry, file *configstore.File, fallback llm.ChatProvider) *ConfigService
                                       →  (reg *model.Registry, ..., fallback model.ChatProvider)
// :122
	if _, ok := llm.Providers[in.Provider]; !ok {   →  model.Providers
// :247
	p, err := llm.New(input.Provider, ...)          →  model.New(input.Provider, ...)
// :254
	for ev := range p.StreamChat(ctx, []llm.Message{{Role: "user", Content: "hi"}}) {
	                                              →  []model.Message{...}
// :356
	p, err := llm.New(active.Provider, ...)         →  model.New(active.Provider, ...)
// :371（注释）
	// 不复用厂商表检查——"forward" 不在 llm.Providers 里（...）
	                                              →  不在 model.Providers 里
```

`server/internal/service/config_test.go`：保留 llm import（:257/:277 的 ForwardProvider 由 Task 2 换掉）的同时新增 model import；:25 `llm.New(` → `model.New(`；:29 `llm.NewRegistry(` → `model.NewRegistry(`。

- [ ] **Step 5: 全量验证**

Run: `cd server && gofmt -l . && go vet ./... && go test ./... -race`
Expected: 全绿。`grep -rn "internal/llm" --include="*.go" .` 应只剩 `internal/llm` 目录自身与 config 两个文件的 forward 引用。

- [ ] **Step 6: Commit**

```bash
cd .. && git add -A server/ && git commit -m "refactor(llm): 迁移 provider/registry/openai_compat 至 lovely-agent/model"
```

---

### Task 2: forward 迁入 model/forward 子包，删除 internal/llm

**Files:**
- Move: `server/internal/llm/{forward.go, forward_spec.go, forward_template.go, forward_extract.go, forward_test.go, forward_spec_test.go, forward_template_test.go, forward_extract_test.go}` → `server/internal/lovely-agent/model/forward/`
- Modify: `server/internal/service/config.go`、`server/internal/service/config_test.go`（forward 引用）
- Delete: `server/internal/llm/`（迁空后）

**Interfaces:**
- Consumes: Task 1 的 model 包与仍带 model. 前缀的 forward 文件
- Produces: `lovelybuddy/server/internal/lovely-agent/model/forward`（ForwardProvider/NewForward/ParseForwardSpec/UsesPlaceholder/ExtractPath，导出名不变）

- [ ] **Step 1: 移动文件并改 package 声明**

```bash
cd server
mkdir -p internal/lovely-agent/model/forward
git mv internal/llm/forward.go internal/llm/forward_spec.go internal/llm/forward_template.go \
       internal/llm/forward_extract.go internal/llm/forward_test.go internal/llm/forward_spec_test.go \
       internal/llm/forward_template_test.go internal/llm/forward_extract_test.go \
       internal/lovely-agent/model/forward/
```

8 个文件首行 `package llm` → `package forward`。其余内容**不改**（Task 1 已加 model import 与前缀；forward_spec/forward_extract 及其测试本就无 Message/StreamEvent 引用）。删除已空的 `server/internal/llm/` 目录。

- [ ] **Step 2: config.go / config_test.go 换 forward 引用**

`server/internal/service/config.go`：import 块删除 `"lovelybuddy/server/internal/llm"`，新增 `"lovelybuddy/server/internal/lovely-agent/model/forward"`；替换：

```go
// :347
		p, err := llm.NewForward(active.Forward, active.Model)   →  forward.NewForward(...)
// :373
	if _, err := llm.ParseForwardSpec(raw); err != nil {         →  forward.ParseForwardSpec(raw)
// :376
	if model == "" && llm.UsesPlaceholder(raw, "model") {        →  forward.UsesPlaceholder(raw, "model")
// :384
	spec, err := llm.ParseForwardSpec(input.Forward)             →  forward.ParseForwardSpec(input.Forward)
```

注意 :376 的 `model == ""` 是局部变量名，不是包名——仅 `llm.UsesPlaceholder` 改前缀。

`server/internal/service/config_test.go`：import llm → forward；:257 `svc.reg.Current().(*llm.ForwardProvider)` → `(*forward.ForwardProvider)`；:277 `p.(*llm.ForwardProvider)` → `p.(*forward.ForwardProvider)`；:262 注释里「不能走 llm.New 而被丢弃」→「不能走 model.New 而被丢弃」。

- [ ] **Step 3: 全量验证**

Run: `cd server && gofmt -l . && go vet ./... && go test ./... -race`
Expected: 全绿。`grep -rn "internal/llm" --include="*.go" .` 输出为空（internal/llm 已删）；`go test ./internal/lovely-agent/model/forward/ -count=1` 单独跑也绿。

- [ ] **Step 4: Commit**

```bash
cd .. && git add -A server/ && git commit -m "refactor(llm): forward 八件套迁入 lovely-agent/model/forward"
```

---

### Task 3: agent 包 + Loop 单轮直通 + service 重组

**Files:**
- Create: `server/internal/lovely-agent/agent/event.go`、`context.go`、`loop.go`、`context_test.go`、`loop_test.go`
- Modify: `server/internal/service/chat.go`（重组为组装层）、`prompt.go`（删 BuildMessages）、`prompt_test.go`（删 BuildMessages 用例）

**Interfaces:**
- Consumes: `model` 包（ChatProvider/Message/StreamEvent/Registry）
- Produces: `agent.ContextConfig`（SystemPrompt/PersonaLoader/History/HistoryLimit）、`agent.Build`、`agent.Loop.Run(ctx, avatarSlug, userText) <-chan LoopEvent`、`agent.LoopEvent{Delta, Err}`

- [ ] **Step 1: 创建 event.go**

Create `server/internal/lovely-agent/agent/event.go`：

```go
package agent

// LoopEvent loop 输出事件；Err 非 nil 表示本轮失败（通道随后关闭）。
// done 由通道关闭隐式表达——与模型层 StreamEvent 同构；工具状态事件随工具循环功能加入
// （harness 设计 §4.4，本版本不建死字段）。
type LoopEvent struct {
	Delta string
	Err   error
}
```

- [ ] **Step 2: 创建 context.go**

Create `server/internal/lovely-agent/agent/context.go`：

```go
package agent

import (
	"context"

	"lovelybuddy/server/internal/lovely-agent/model"
)

// ContextConfig 上下文构建的注入源，wiring 唯一归 service（harness 设计 §2.1）。
// 记忆检索与技能指令是后续功能的注入位（设计 §4.1：稳定前缀 → 历史 → 技能指令 → 检索记忆 → 最新输入），
// 本版本只实现 system → 历史 → 最新输入三段。
type ContextConfig struct {
	// SystemPrompt 人设+动作协议文案（桌宠专属，service 注入；入参为形象人设文本）。
	SystemPrompt func(persona string) string
	// PersonaLoader 取形象人设文本（avatar.json.persona）；(text, false) = 无。
	PersonaLoader func(avatarSlug string) (string, bool)
	// History 本次对话历史（不含最新输入）。service 在落用户消息前已读好并捕获——
	// 落库先行（记录语义），上下文构建不接触 store。
	History func() []model.Message
	// HistoryLimit 历史裁剪条数（0 = 不裁剪）。
	HistoryLimit int
}

// Build 按固定顺序组装请求：system（人设+动作协议）→ 历史 → 最新输入（裁最旧）。
func Build(ctx context.Context, cc ContextConfig, avatarSlug, userText string) []model.Message {
	history := cc.History()
	if cc.HistoryLimit > 0 && len(history) > cc.HistoryLimit {
		history = history[len(history)-cc.HistoryLimit:]
	}
	persona, _ := cc.PersonaLoader(avatarSlug)
	msgs := make([]model.Message, 0, len(history)+2)
	msgs = append(msgs, model.Message{Role: "system", Content: cc.SystemPrompt(persona)})
	msgs = append(msgs, history...)
	msgs = append(msgs, model.Message{Role: "user", Content: userText})
	return msgs
}
```

- [ ] **Step 3: 创建 loop.go**

Create `server/internal/lovely-agent/agent/loop.go`：

```go
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
```

- [ ] **Step 4: 创建 context_test.go（BuildMessages 用例迁入）**

Create `server/internal/lovely-agent/agent/context_test.go`：

```go
package agent

import (
	"context"
	"strings"
	"testing"

	"lovelybuddy/server/internal/lovely-agent/model"
)

func TestBuildOrderAndTrim(t *testing.T) {
	cc := ContextConfig{
		SystemPrompt:  func(persona string) string { return "人设:" + persona },
		PersonaLoader: func(string) (string, bool) { return "你是猫。", true },
		History: func() []model.Message {
			history := make([]model.Message, 0, 25)
			for i := 0; i < 25; i++ {
				history = append(history, model.Message{Role: "user", Content: "m" + string(rune('a'+i))})
			}
			return history
		},
		HistoryLimit: 20,
	}
	msgs := Build(context.Background(), cc, "haru", "最新")
	if len(msgs) != 22 { // system + 20 历史 + 1 输入
		t.Fatalf("len=%d", len(msgs))
	}
	if msgs[0].Role != "system" || !strings.HasPrefix(msgs[0].Content, "人设:你是猫。") {
		t.Fatalf("首条应为 system 人设: %+v", msgs[0])
	}
	if msgs[len(msgs)-1].Role != "user" || msgs[len(msgs)-1].Content != "最新" {
		t.Fatalf("末条应为最新输入: %+v", msgs[len(msgs)-1])
	}
	if msgs[1].Content != "m"+string(rune('a'+5)) { // 裁掉最旧 5 条
		t.Fatalf("历史裁剪应保最近 20 条: %+v", msgs[1])
	}
}

func TestBuildNoHistoryLimit(t *testing.T) {
	cc := ContextConfig{
		SystemPrompt:  func(string) string { return "s" },
		PersonaLoader: func(string) (string, bool) { return "", false },
		History:       func() []model.Message { return nil },
	}
	msgs := Build(context.Background(), cc, "", "hi")
	if len(msgs) != 2 || msgs[0].Role != "system" || msgs[1].Content != "hi" {
		t.Fatalf("无历史应仅 system+user: %+v", msgs)
	}
}
```

- [ ] **Step 5: 创建 loop_test.go**

Create `server/internal/lovely-agent/agent/loop_test.go`：

```go
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
	var evs []LoopEvent
	for ev := range loop.Run(ctx, "", "长问题") {
		evs = append(evs, ev)
		cancel()
	}
	if len(evs) != 1 || evs[0].Delta != "已经说到一半" {
		t.Fatalf("取消后应静默关闭: %+v", evs)
	}
}
```

- [ ] **Step 6: 先跑 agent 测试确认独立编译**

Run: `cd server && go test ./internal/lovely-agent/agent/ -count=1`
Expected: PASS（6 个测试函数：context_test 2 个 + loop_test 4 个）

- [ ] **Step 7: prompt.go / prompt_test.go 拆分**

`server/internal/service/prompt.go`：删除 `BuildMessages` 函数与 `"lovelybuddy/server/internal/dao"` import；`defaultPersona`/`SystemPrompt` 原样保留。文件注释改为：

```go
// 人设与动作协议文案（桌宠专属）：经 agent.ContextConfig.SystemPrompt 注入 harness。
```

`server/internal/service/prompt_test.go`：删除 `TestBuildMessagesOrderAndTrim` 与 `"lovelybuddy/server/internal/dao"`、`"time"` import（不再使用则删）；`TestSystemPromptDefaultPersona`/`TestSystemPromptCustomPersonaPrepends` 原样保留。

- [ ] **Step 8: chat.go 重组为组装层**

`server/internal/service/chat.go` 全量替换为：

```go
package service

import (
	"context"
	"strings"

	"lovelybuddy/server/internal/assets"
	"lovelybuddy/server/internal/dao"
	"lovelybuddy/server/internal/lovely-agent/agent"
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

// historyLimit 每次请求注入的历史条数（design.md §4 prompt 顺序中的「历史」段）。
const historyLimit = 20

type ChatService struct {
	store    ChatStore
	reg      *model.Registry
	modelDir string
}

// NewChatService 以厂商注册表组装：每次对话从 reg 取当前厂商（M3 设置界面热切换）。
func NewChatService(store ChatStore, reg *model.Registry, modelDir string) *ChatService {
	return &ChatService{store: store, reg: reg, modelDir: modelDir}
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
			SystemPrompt:  SystemPrompt,
			PersonaLoader: func(slug string) (string, bool) { return assets.PersonaText(s.modelDir, slug) },
			History:       func() []model.Message { return toModel(history) },
			HistoryLimit:  historyLimit,
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
```

注意：Loop.Run 内也做了 Configured 检查（harness 自防御）；service 步骤 1 的前置检查保证事件顺序不变（未配 key 时不建会话不发 meta），正常路径 loop 内的检查不触发。

- [ ] **Step 9: 回归验证（断言不改的硬门槛）**

Run: `cd server && gofmt -l . && go vet ./... && go test ./... -race`
Expected: 全绿。重点：`service/chat_test.go` 与 `internal/server/server_test.go` 的断言**未改一字**（只在前置任务改过 import/类型名），SSE 事件序、落库、错误文案全部通过 = 零行为变化的证明。`go test ./internal/service/ -run TestStream -count=1 -v` 单独再跑一遍确认 5 个 Stream 用例全绿。

- [ ] **Step 10: Commit**

```bash
cd .. && git add -A server/ && git commit -m "refactor(chat): 重组为 lovely-agent agent loop 单轮直通入口"
```

---

### Task 4: 文档路径同步 + CLAUDE.md + 全量收尾

**Files:**
- Modify: `docs/forward-provider.md`（路径表/文件树同步到新包路径）
- Modify: `CLAUDE.md`（架构速览补 lovely-agent 行）
- 不动：`docs/design.md`（Task 7 门控）、历史计划文档

**Interfaces:**
- Consumes: Task 1-3 完成后的文件布局
- Produces: 文档与代码布局一致；全量验证绿

- [ ] **Step 1: forward-provider.md 路径同步**

`docs/forward-provider.md` 逐处替换（路径换新，行号以 `grep -n` 实况核正后再填）：

| 行 | 旧 | 新 |
|---|---|---|
| :45 | `server/internal/llm/provider.go:19-26` | `server/internal/lovely-agent/model/provider.go`（行号以实况核正） |
| :46 | `server/internal/llm/provider.go:36-41` | 同上核正 |
| :47 | `server/internal/llm/openai_compat.go` | `server/internal/lovely-agent/model/openai_compat.go` |
| :48 | `server/internal/llm/registry.go` | `server/internal/lovely-agent/model/registry.go` |
| :135 | `server/internal/llm/`（文件树块） | `server/internal/lovely-agent/model/forward/`（树节点按新布局调整） |
| :360-363 | `server/internal/llm/forward*.go` | `server/internal/lovely-agent/model/forward/forward*.go` |

核正命令：`grep -n "Provider 抽象\|ChatProvider 接口" server/internal/lovely-agent/model/provider.go` 等，把表中的旧行号换成新实际行号；forward 各文件行号因 import 增加有偏移，同样以实况为准。替换只动路径/行号字符串，spec 语义内容（接口名、行为描述）一字不改。

- [ ] **Step 2: CLAUDE.md 架构速览补一行**

`CLAUDE.md` 架构速览的 server 行（`server`（Go + gin）…`internal/db` pgvector）末尾追加：

```markdown
；`internal/lovely-agent` harness 分层（model/agent 已落地，memory/extension 规划中——docs/superpowers/specs/2026-10-25-harness-layering-design.md）
```

- [ ] **Step 3: 全量验证**

Run: `make test`（Go vet/test + typecheck + vitest 全量）+ `cd server && gofmt -l .`
Expected: 全绿、gofmt 无输出。`grep -rn "internal/llm" server --include="*.go"` 为空；`grep -rn "internal/llm" docs/forward-provider.md CLAUDE.md` 为空（历史计划文档除外）。

- [ ] **Step 4: Commit**

```bash
git add docs/forward-provider.md CLAUDE.md && git commit -m "docs(lovely-agent): 同步 harness 迁移后的包路径与架构说明"
```

---

## Self-Review 记录

- **Spec 覆盖**：design §11 步骤 1 → Task 1+2（包迁移，forward 子包）；步骤 2 → Task 3（Loop 单轮直通 + context 注入）；§2.1 依赖硬规则 → Task 3 chat.go 组装（agent 不 import service/dao，toModel 转换在 service）；§3 model 层迁入 → Task 1；§4.1 ContextConfig 注入源 → Task 3 context.go；§4.3 单轮直通 → Task 3 loop.go；§4.4 MotionFilter 留 service → Task 3 chat.go 不动 motionfilter.go；§9 错误契约（中文前缀、ctx 静默）→ loop.go 保留原文案。步骤 3-7（MB/扩展/工具循环/M5/M6）不在本计划（设计 §11 明示另立计划）。骨架接口裁决见 Global Constraints。
- **占位符扫描**：无 TBD/TODO；所有代码块完整；Task 4 行号核正给定了核正命令与原则（行号属实况数据，计划内已声明以 grep 实况为准，非占位符）。
- **类型一致性**：`agent.LoopEvent`/`ContextConfig`/`Build`/`NewLoop`/`Run` 在 Task 3 各文件定义与 chat.go 使用处一致；`PersonaLoader` 签名 `(string) (string, bool)` 对齐 `assets.PersonaText(root, slug string) (string, bool)`（闭包绑定 root）；Task 1 前缀后的 `model.Message`/`model.StreamEvent` 在 Task 2 移动时已就位（Task 2 只改 package 声明）。
- **回归线**：Global Constraints 锁定「断言不改」——chat_test/server_test 只允许 import/类型名变化，Task 3 Step 9 单独重跑 Stream 用例。

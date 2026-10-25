# 转发 Provider 技术方案

> 状态：待实施
> 目标：给桌宠加一个「声明式 HTTP 转发」对话 provider，接任意本地 AI 应用只需写一份配置，不改代码。
> 配套文档（不在本仓库）：`~/code/agent/lovely-buddy-接入文档/转发配置指引.md`（给使用者的配置说明）。

---

## 1. 目标与非目标

### 1.1 要做的

| 能力 | 说明 |
|---|---|
| 请求模板 | 把 OpenAI 形状的 messages 渲染成目标后端要的任意 JSON |
| 响应提取 | 从 JSON / 纯文本 / NDJSON / SSE 里把回复文本抠出来 |
| 流式合成 | 目标是一次性返回的，按块推给界面，保住打字机效果 |
| 上下文开关 | 决定带不带桌宠的人设、带不带历史（决定「脑」在谁那边） |
| 自定义探活 | 「测试连接」打配置指定的地址，不复用写死的 10 秒补全 |

### 1.2 明确不做

| 不做 | 原因 |
|---|---|
| 不存对话、不存记忆、不做人格 | 这些归接入的后端。转发层一旦存东西，就变成第二个脑 |
| 不实现工具调用 / 函数调用 | 桌宠不是 agent 宿主 |
| 不做协议双向（后端主动推消息） | 那是反方向，需要桌宠做 MCP server，另一个里程碑 |
| 不做「多后端编排」（同时问两家） | 单连接单后端，切换靠换激活连接 |

---

## 2. 现状与插入点

现有对话链路只有一个抽象，加实现不动调用方：

```
service.ChatService ──▶ llm.Registry.Current() ──▶ ChatProvider.StreamChat()
                                                        │
                                          ┌─────────────┴─────────────┐
                                    OpenAICompat                 ForwardProvider（本次新增）
```

| 现有构件 | 位置 | 本次是否改 |
|---|---|---|
| `ChatProvider` 接口（`StreamChat` / `Configured` / `KeyEnv`） | `server/internal/llm/provider.go:19-26` | 不改 |
| `Providers` 厂商表 | `server/internal/llm/provider.go:36-41` | **不加** forward 条目（见 §4.4） |
| `OpenAICompat` | `server/internal/llm/openai_compat.go` | 不改 |
| `Registry`（热切换） | `server/internal/llm/registry.go` | 不改 |
| `Connection` 结构 | `server/internal/configstore/configstore.go:19-28` | **加字段** |
| `Validate` / `Test` / `swapActive` | `server/internal/service/config.go:110` / `:217` / `:316` | **加分支** |
| 聊天前置检查 | `server/internal/service/chat.go:69`（`if !provider.Configured()`） | 不改（靠 `Configured()` 返回 true 绕过） |

**关键**：`ChatProvider` 只有三个方法，`ForwardProvider` 实现它之后，聊天主链路一行不用动。

---

## 3. 数据模型

### 3.1 持久化结构

`configstore.Connection` 增加一个字段：

```go
type Connection struct {
	ID        string          `json:"id"`
	Provider  string          `json:"provider"`   // 新增取值 "forward"
	BaseURL   string          `json:"base_url"`   // forward 时不使用
	Model     string          `json:"model"`      // forward 时可为空
	MaxTokens int             `json:"max_tokens"` // forward 时不使用
	APIKey    string          `json:"api_key"`    // forward 时可为空
	Forward   json.RawMessage `json:"forward,omitempty"` // 仅 provider=="forward" 时有值
	LastCheck *time.Time      `json:"last_check"`
	CheckFail bool            `json:"check_fail"`
}
```

用 `json.RawMessage` 而不是强类型结构体，理由有两条：

1. **校验时机可控**——保存时解析一次，失败就拒；运行时不重复解析错误的结构。
2. **向前兼容**——将来配置 schema 加字段，只要不改已有字段语义，老代码读新配置不报错。

老配置文件没有 `forward` 键 → 零值 `nil` → 不受影响，**不需要写迁移**。

### 3.2 配置 schema（Go 侧强类型，仅解析用）

```go
type ForwardSpec struct {
	Version  int           `json:"version"`
	Request  ForwardReq    `json:"request"`
	Response ForwardResp   `json:"response"`
	Options  ForwardOpts   `json:"options"`
	Probe    *ForwardProbe `json:"probe"`
}

type ForwardReq struct {
	URL       string         `json:"url"`
	Method    string         `json:"method"`
	Headers   map[string]string `json:"headers"`
	Query     map[string]string `json:"query"`
	Body      any            `json:"body"`        // 任意 JSON，渲染后序列化
	TimeoutMS int            `json:"timeout_ms"`  // 默认 120000
}

type ForwardResp struct {
	Type      string `json:"type"`       // json | text | ndjson | sse_openai
	TextPath  string `json:"text_path"`
	ErrorPath string `json:"error_path"`
}

type ForwardOpts struct {
	IncludeSystem    *bool  `json:"include_system"`     // 指针：区分「未填」与 false，默认 true
	IncludeHistory   *bool  `json:"include_history"`    // 同上
	SessionID        string `json:"session_id"`         // 默认 "default"
	MockStream       *bool  `json:"mock_stream"`        // 默认 true
	MockStreamChunk  int    `json:"mock_stream_chunk"`  // 默认 12（按 rune 计）
	MockStreamDelayMS int   `json:"mock_stream_delay_ms"` // 默认 20
}

type ForwardProbe struct {
	URL          string `json:"url"`
	Method       string `json:"method"`        // 默认 GET
	ExpectStatus int    `json:"expect_status"` // 默认 200
}
```

`IncludeSystem` / `IncludeHistory` / `MockStream` 用 `*bool`：**默认值是 true，而 Go 的零值是 false**，不用指针就无法区分「用户写了 false」和「用户没写」。

---

## 4. 核心实现

### 4.1 模块划分

```
server/internal/llm/
├── forward.go          ForwardProvider：组装流程、实现 ChatProvider 三方法
├── forward_spec.go     ForwardSpec 解析 + 校验 + 默认值填充
├── forward_template.go 占位符渲染
└── forward_extract.go  路径提取（text_path / error_path）
```

| 文件 | 导出 | 行数估计 |
|---|---|---|
| `forward.go` | `NewForward`, `ForwardProvider` | ~180 |
| `forward_spec.go` | `ParseForwardSpec` | ~120 |
| `forward_template.go` | `renderBody`, `renderString` | ~90 |
| `forward_extract.go` | `ExtractPath` | ~60 |

### 4.2 `ForwardProvider`

```go
type ForwardProvider struct {
	spec   *ForwardSpec
	client *http.Client
	model  string // 仅用于 {{model}}，可为空
}

func NewForward(raw json.RawMessage, model string) (*ForwardProvider, error) {
	spec, err := ParseForwardSpec(raw)
	if err != nil {
		return nil, err
	}
	return &ForwardProvider{
		spec:   spec,
		client: &http.Client{Timeout: time.Duration(spec.Request.TimeoutMS) * time.Millisecond},
		model:  model,
	}, nil
}

func (p *ForwardProvider) Configured() bool { return p.spec != nil }
func (p *ForwardProvider) KeyEnv() string   { return "" }
```

`Configured()` 返回 `spec != nil`：转发不需要 key，但 `chat.go:69` 会拦「未配置」。返回 true 让主链路直接放行。

### 4.3 `StreamChat` 流程

```
1. 按 options 裁剪 msgs，得到 eff（这一步在前，后面全部基于 eff）
   include_system=false  → 从 eff 删掉 role=="system" 的条目
   include_history=false → eff 只留 [system(若保留), 最后一条 user]
2. 拆分 eff
   system   = eff 里 role=="system" 的第一条（若有）
   lastUser = eff 最后一条 role=="user"
   history  = eff 去掉 system 与最后一条 user 之后的部分
3. 渲染 body（占位符替换）
4. 组装请求：URL + query + headers，WithContext(ctx)
5. 按 response.type 分支读取
6. 推 channel，全程 select 检查 ctx.Done()
```

**裁剪必须作用在 msgs 上而不是各占位符上**：否则 `{{system}}` 被清空了、`{{messages}}` 里还带着 system，两个占位符的语义就打架了。裁剪后 `{{messages}}` 永远等于 `eff`，与 `{{system}}` / `{{history}}` 天然一致。

伪代码：

```go
func (p *ForwardProvider) StreamChat(ctx context.Context, msgs []Message) <-chan StreamEvent {
	ch := make(chan StreamEvent)
	go func() {
		defer close(ch)
		eff := applyOptions(msgs, p.spec.Options) // 裁剪，见上
		sys, lastUser, history := split(eff)
		body, err := renderBody(p.spec.Request.Body, placeholderCtx{
			LastUser: lastUser, System: sys, Messages: eff,
			History: history, Model: p.model,
			SessionID: p.spec.Options.SessionID,
			Now: strconv.FormatInt(time.Now().UnixMilli(), 10),
		})
		if err != nil { ch <- StreamEvent{Err: err}; return }

		resp, err := p.do(ctx, body)
		if err != nil { ch <- StreamEvent{Err: err}; return }
		defer resp.Body.Close()

		if err := p.emit(ctx, resp, ch); err != nil && ctx.Err() == nil {
			ch <- StreamEvent{Err: err}
		}
	}()
	return ch
}
```

### 4.4 为什么不在 `Providers` 里加 `forward`

`llm.New()`（`openai_compat.go:24`）遇到 `Providers` 里的名字就构造 `OpenAICompat`。如果把 `forward` 加进表里，`New()` 会用一个空 BaseURL 建 go-openai 客户端，**保存时能过、聊天时必炸**。

所以：

- `Providers` **不加** `forward`；
- `service.Validate`（`config.go:110`）在函数开头分支：`provider == "forward"` 时走 `validateForward`，跳过后面的厂商表检查和 model/key 必填；
- `swapActive`（`:316`）和 `Test`（`:217`）按 provider 分支到 `llm.NewForward`。

这是本方案唯一「绕过现有约束」的地方，必须三处一起改，改漏一处就会出现「保存成功但聊天报未知厂商」。

### 4.5 模板渲染

```go
var phRe = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_:.-]+)\s*\}\}`)

func renderBody(v any, ctx placeholderCtx) (any, error)
func renderString(s string, ctx placeholderCtx) (any, error)
```

`renderString` 是核心，两条规则：

| 输入 | 判断 | 输出 |
|---|---|---|
| `"{{messages}}"` | `phRe.FindStringSubmatch` 覆盖整个字符串（去掉首尾空白后） | **原始类型**：`[]Message` |
| `"用户说：{{last_user}}"` | 只覆盖一部分 | 字符串拼接 |

实现要点：先用 `phRe.FindStringIndex` 判断是否「整串匹配」，是则返回原始值，否则 `ReplaceAllStringFunc` 拼接。

`renderBody` 递归遍历 `map[string]any` / `[]any`，对每个 string 调 `renderString`。`map` 的键不渲染（键名含占位符没有意义）。

占位符取值表：

| 名字 | 值来源 | 类型 |
|---|---|---|
| `last_user` | 最后一条 user 的 Content | string |
| `system` | 裁剪后的 system Content | string |
| `messages` | 原始 `[]Message` | `[]Message` |
| `history` | 裁剪后的历史 | `[]Message` |
| `model` | `ForwardProvider.model` | string |
| `session_id` | `Options.SessionID`（默认 `default`） | string |
| `now` | 毫秒时间戳 | string |
| `env:NAME` | `os.Getenv(NAME)` | string |

`[]Message` 序列化成 `[{"role":"user","content":"…"}]`，与 OpenAI 形状一致，大多数自建后端能直接吃。

**大小写**：占位符名一律小写匹配，`{{LAST_USER}}` 不认。要在校验期报错，别静默变空串。

### 4.6 路径提取

```go
func ExtractPath(root any, path string) (string, error)
```

支持的写法：

| 写法 | 说明 |
|---|---|
| `reply` | 顶层字段 |
| `data.text` | 嵌套 |
| `choices[0].message.content` | 数组下标 |
| `data.items[0].content` | 组合 |

实现：`strings.Split(path, ".")`，每段用 `^([^\[\]]+)((?:\[\d+\])*)$` 拆出字段名和下标列表。

返回值规则：

- `string` → 原样
- `json.Number` / `float64` → 转字符串
- `nil` → 返回错误「路径命中 null」
- `map` / `[]any` → 返回错误「路径命中非文本值，检查 text_path」

**报错要说清是哪一段失败的**，比如 `data.items[0].content 在 [0] 处越界（长度 0）`。配置写错是这条路上最常见的故障。

### 4.7 四种响应类型

| type | 读取方式 | 推流粒度 |
|---|---|---|
| `json` | `json.Unmarshal(全body)` → `ExtractPath` | 整段，按 `mock_stream_chunk` 切块 |
| `text` | 把 body 当纯文本（`text_path` 忽略） | 同上 |
| `ndjson` | `bufio.Scanner` 逐行 `Unmarshal` → `ExtractPath` | 每行一段 |
| `sse_openai` | 逐行找 `data: `，`[DONE]` 结束，取 `choices[0].delta.content` | 每个 delta |

`mock_stream` 分块实现（**按 rune 切，不能按 byte**，否则中文会切成乱码）：

```go
func (p *ForwardProvider) emitChunked(ctx context.Context, text string, ch chan<- StreamEvent) error {
	runes := []rune(text)
	n := p.spec.Options.MockStreamChunk // 默认 12
	for i := 0; i < len(runes); i += n {
		end := i + n
		if end > len(runes) { end = len(runes) }
		select {
		case ch <- StreamEvent{Delta: string(runes[i:end])}:
		case <-ctx.Done():
			return ctx.Err()
		}
		if !p.sleepCtx(ctx, p.spec.Options.MockStreamDelayMS) {
			return ctx.Err()
		}
	}
	return nil
}
```

`sleepCtx` 必须用 `select { case <-time.After(d): case <-ctx.Done(): }`，不能用 `time.Sleep`——否则用户点「停止」后要等到整段推完才响应。

### 4.8 错误处理

| 情况 | 处理 |
|---|---|
| ctx 取消 | 静默关通道，**不推 Err**（与 `OpenAICompat` 一致：`ctx.Err() == nil` 才推） |
| 非 2xx | 读 body，尝试 `error_path`；拿不到就截断 512 字节放进错误文案 |
| 连接失败 | 原样包一层：`转发失败: <err>` |
| `text_path` 命中非文本 | 报错并带上实际类型 |
| 响应体超过 8 MB | 拒绝，提示 `text_path` 可能写错（把整个 JSON 当文本取了） |

### 4.9 探活

`ConfigService.Test`（`config.go:217`）加分支：

```
provider == "forward":
  1. ParseForwardSpec 校验语法与必填
  2. 有 probe → 发 probe 请求，比较 expect_status（默认 200）
  3. 无 probe → 直接返回 OK，文案「配置合法（未配置探活地址）」
```

**不能复用现有的 `max_tokens:1` + 10 秒路径**（`config.go:86`）：代理型后端跑一轮要几十秒，必然假失败。这是给转发单独开分支的主要理由。

---

## 5. 文件级改动清单

| # | 文件 | 改动 | 量级 |
|---|---|---|---|
| 1 | `server/internal/llm/forward.go` | 新增 | ~180 行 |
| 2 | `server/internal/llm/forward_spec.go` | 新增（解析 + 默认值 + 校验） | ~120 行 |
| 3 | `server/internal/llm/forward_template.go` | 新增 | ~90 行 |
| 4 | `server/internal/llm/forward_extract.go` | 新增 | ~60 行 |
| 5 | `server/internal/configstore/configstore.go` | `Connection` 加 `Forward json.RawMessage` | +1 行 |
| 6 | `server/internal/service/config.go` | `TestInput`/`ConnInput` 加 `Forward`；`Validate` 分支；`Test` 分支；`swapActive` 分支 | ~40 行 |
| 7 | `server/internal/controller/*.go` | 透传 `forward` 字段（若有字段白名单） | 视现状 |
| 8 | `apps/desktop/.../settings/ConnectionPage.tsx` | 下拉加选项；`FormState` 加 `forward`；条件渲染 JSON 框 | ~80 行 |
| 9 | `apps/desktop/.../settings/connectionFormat.ts` | `PROVIDER_LABEL` / `PROVIDER_DEFAULT_URL` 加 `forward` | +2 行 |
| 10 | `apps/desktop/.../lib/configApi.ts` | `ConnectionInfo` 加 `forward?: string` | +1 行 |

### 5.1 前端细节

现有表单结构（`ConnectionPage.tsx`）：

- `FormState`（`:8`）：`{provider, baseUrl, apiKey, model, maxTokens}`
- `EMPTY_FORM`（`:15`）：`provider: 'deepseek'`
- `buildInput`（`:28-43`）：组装请求体
- 服务商下拉（`:253-258`）：硬编码四个选项

改法：

```
provider === 'forward' 时：
  隐藏 Base URL / API Key / 模型名 / 最大 Token 四个输入
  改显示：
    - 一个 <textarea>（等宽字体，min-h-[160px]）绑 form.forward
    - 一个「填入示例」按钮，塞 §7.1 的模板
    - 一个本地 JSON.parse 校验，红字显示错误行
  提交时 buildInput 带上 forward: form.forward
```

**`forward` 必须发 JSON 对象，不能发字符串。** 后端字段是 `json.RawMessage`，它收的是原始 JSON——如果前端把 textarea 的内容当字符串发（`"forward": "{\"request\":...}"`），反序列化结果是带引号的 JSON 文本，`ParseForwardSpec` 会直接失败。所以：

```ts
// buildInput 里
let forward: unknown
try { forward = JSON.parse(f.forward) }
catch (e) { throw new Error(`转发配置不是合法 JSON：${(e as Error).message}`) }
```

在 `JSON.parse` 这一层拦住，比等后端返回一句 json 语法错误好定位得多。

为什么不保留「模型名」输入框：转发配置里已经有 `{{model}}` 占位符，但绝大多数后端用不到。留着会让用户以为必填。如果 `{{model}}` 被使用且 model 为空，校验期报「配置用到了 {{model}} 但模型名为空」。

### 5.2 后端 API

`ConnInput` / `TestInput`（`service/config.go:27` / `:39`）各加一个字段：

```go
Forward json.RawMessage `json:"forward"`
```

出参 `ConnectionOut`（`:49`）也要回传 `Forward`，否则编辑已有连接时前端拿不到原文。前端回填时用 `JSON.stringify(c.forward, null, 2)` 格式化进 textarea。**注意**：这里回传的是配置本身，不含任何密钥明文（令牌走 `{{env:}}`），可以安全回传。

---

## 6. 兼容性

| 场景 | 结果 |
|---|---|
| 老配置文件（无 `forward` 键） | 零值 nil，行为不变 |
| 老连接继续用 OpenAI 兼容 | 不受影响，`swapActive` 走原分支 |
| `provider: "forward"` 但 `forward` 为空 | 保存时拒绝：「转发配置不能为空」 |
| `forward` JSON 语法错误 | 保存时拒绝，带上 `json.Unmarshal` 的 offset 换算成行列 |
| fallback provider（env 兜底） | 永远是 OpenAICompat，不受影响 |

---

## 7. 测试计划

### 7.1 单元测试

| 文件 | 用例 |
|---|---|
| `forward_template_test.go` | 整串占位符→原始类型；嵌入占位符→拼接；未知名占位符→报错；map 键不渲染；嵌套数组递归 |
| `forward_extract_test.go` | 四种路径写法；越界；命中 null；命中对象；数字转字符串 |
| `forward_spec_test.go` | 缺 url / 缺 type / `json` 无 `text_path` / 默认值填充（含 `*bool` 三态） |
| `forward_test.go` | 用 `httptest.Server` 模拟 4 种 response.type，断言输出全文与分块数 |

### 7.2 关键断言

1. **中文分块不乱码**：输入 `你好世界`，`chunk=2`，应得 `["你好","世界"]` 两段。
2. **ctx 取消即时生效**：`mock_stream_delay_ms=100` 时取消 ctx，通道应在 100ms 内关闭。
3. **`include_system=false` 时 `{{system}}` 为空串**，且 `{{messages}}` 里也不含 system 条目。
4. **非 2xx 带 `error_path`**：断言错误文案里是后端返回的 message，不是原始 HTML。

### 7.3 手工验收

| # | 操作 | 期望 |
|---|---|---|
| 1 | 配置指向本地 mock（json 类型） | 能聊，打字机效果正常 |
| 2 | 中途点「停止」 | 100ms 内停 |
| 3 | 把 `text_path` 改错 | 报「路径未命中」，不是静默空回复 |
| 4 | 配置 `include_system:false` | 对方收不到 system（用 mock 打印请求体验证） |
| 5 | 配 `probe` 指向不存在的端口 | 测试连接失败，文案可读 |
| 6 | 重启应用 | 配置仍在，激活连接仍生效 |

---

## 8. 实施顺序

一次做完，不分期——四块代码加起来 450 行，拆开反而要两次改 `service/config.go`。

```
1. forward_spec.go + 测试         （先定数据形状，其余都有依赖）
2. forward_template.go + 测试
3. forward_extract.go + 测试
4. forward.go + httptest 集成测试
5. configstore + service 三处分支
6. 前端表单
7. 手工验收（用 §7.1 的 mock）
```

第 5 步之前，`forward` provider 无法被激活，但 1-4 步的单测可以独立跑。

---

## 9. 风险与取舍

| 风险 | 影响 | 处理 |
|---|---|---|
| 用户写错 JSON 导致聊天不可用 | 中 | 保存期严格校验 + 运行期报错带段位置；错误文案必须能定位到字段 |
| 转发层被当成「记忆层」用 | 中 | 不存任何状态；文档明确写「记忆在后端」 |
| `mock_stream` 让「停止生成」变迟钝 | 低 | `sleepCtx` + 每块检查 ctx |
| 后端字段变了，配置失效 | 低 | 这是配置驱动的固有维护点，改配置即可，不涉及发版 |
| 配置里出现明文令牌 | 中 | 文档要求用 `{{env:NAME}}`；前端示例里不出现任何真实令牌 |
| 四条响应类型不够覆盖未来后端 | 低 | 新增一种类型约 30 行，`emit` 里加一个 case |

### 9.1 一个明确的取舍

**不做「请求体重试」**。转发失败就是失败，不自动重发。理由：无法判断后端是否有副作用（例如它真的发了条 QQ 消息）。重试策略留给用户用 `clientRequestId` 之类的手段在后端处理。

---

## 10. 与接入路线的关系

```
路线 A（本文档）：桌宠 ──转发──▶ 自带人格与记忆的后端     ← 推荐
路线 B：桌宠 ──OpenAI 协议──▶ 本身就是 OpenAI 兼容的后端   ← 见外部附录
路线 C：桌宠 ──OpenAI 协议──▶ 额外搭一层协议网关 ──▶ 后端  ← 有了 A 就不需要
```

A 做完之后 C 就消失了——协议翻译这件事由桌宠自己做，不需要在外面多养一个进程。

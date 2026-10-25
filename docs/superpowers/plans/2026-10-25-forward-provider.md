# 转发 Provider 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给桌宠加「声明式 HTTP 转发」对话 provider——接任意本地 AI 应用（如 dsh 后端）只需写一份 JSON 配置，零代码适配，且不存对话/记忆（脑在接入端）。

**Architecture:** 新增 `llm.ForwardProvider` 实现既有 `ChatProvider` 接口，聊天主链路（`service.ChatService`）一行不改。OpenAI 形状的 messages → 按配置裁剪（include_system/include_history）→ 模板渲染占位符 → 发 HTTP → 按 response.type（json/text/ndjson/sse_openai）提取文本 → 按 rune 切块模拟流式推给界面。配置存 `configstore.Connection.Forward`（json.RawMessage），保存期严格校验；「测试连接」走独立 probe 分支，不复用 1-token 补全路径。

**Tech Stack:** Go 1.27（gin + 现有 llm 抽象）、http/httptest、React 18 + zustand + Tailwind v4、vitest。

**Spec:** `docs/forward-provider.md`（本计划的唯一设计基准；配套使用者文档在仓库外 `~/code/agent/lovely-buddy-接入文档/转发配置指引.md`，本次不动）

## Global Constraints

- Commit：Conventional Commits，subject 小写开头，直接提交 main，不走分支/PR；每条 commit 以 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 结尾。
- Go 测试与源码同目录（Go 忽略 `_` 开头目录，不能用 `__test__/`）；前端测试放功能目录 `__test__/`。
- 前端格式：单引号/无分号/无尾逗号/120 宽（`.prettierrc`）；每个前端 commit 前跑 `pnpm format:check`。
- 样式：Tailwind v4 工具类全量，JSX 只写工具类；互斥状态必须整支分支。
- 用户可见文案：产品显示名 **AI桌宠**，禁用具体角色名；后端错误文案中文、可定位到字段。
- 每个任务结束跑 `cd server && go vet ./... && go test ./...`（前端任务另跑 vitest + format:check）全绿才能 commit。
- `llm.Providers` 表**不得**加 `forward`（spec §4.4：`llm.New` 会用空 BaseURL 建 go-openai 客户端，保存能过、聊天必炸）。

---

## 文件结构总览

| 文件 | 责任 | 任务 |
|---|---|---|
| `server/internal/llm/forward_spec.go`（新） | ForwardSpec 类型、解析、默认值、校验、占位符白名单扫描、UsesPlaceholder | 1 |
| `server/internal/llm/forward_template.go`（新） | placeholderCtx、renderBody/renderString 占位符渲染 | 2 |
| `server/internal/llm/forward_extract.go`（新） | ExtractPath 点路径取值（含数组下标） | 3 |
| `server/internal/llm/forward.go`（新） | ForwardProvider：裁剪/拆分/请求/四响应类型/分块流式/错误处理 | 4 |
| `server/internal/llm/provider.go`（改） | `Message` 加 json tag（`{{messages}}` 序列化形状） | 2 |
| `server/internal/configstore/configstore.go`（改） | `Connection` 加 `Forward json.RawMessage` | 5 |
| `server/internal/service/config.go`（改） | ConnInput/TestInput/ConnectionOut 加 Forward；Validate/Test/swapActive 三处分支；newConn/Update/toTestInput/dedup | 5 |
| `server/internal/controller/config.go`（改） | Add/Update 的 Validate 预检透传 Forward | 5 |
| `apps/desktop/src/renderer/src/lib/configApi.ts`（改） | 三个接口类型加 `forward?: unknown` | 6 |
| `apps/desktop/src/renderer/src/pet/settings/connectionFormat.ts`（改） | PROVIDER_LABEL 加 forward；modelLabel；hostOf 取 request.url | 6 |
| `apps/desktop/src/renderer/src/store/connectionStore.ts`（改） | 测试成功文案按有无 latency_ms 分支 | 6 |
| `apps/desktop/src/renderer/src/pet/settings/ConnectionPage.tsx`（改） | 下拉加选项、条件渲染 JSON 框、示例按钮、JSON 校验、buildInput 组装 | 6 |

---

### Task 1: ForwardSpec 解析与校验

**Files:**
- Create: `server/internal/llm/forward_spec.go`
- Test: `server/internal/llm/forward_spec_test.go`

**Interfaces:**
- Consumes: 无（本任务第一个）
- Produces:
  - `type ForwardSpec struct { Version int; Request ForwardReq; Response ForwardResp; Options ForwardOpts; Probe *ForwardProbe }`（字段带 json tag）
  - `type ForwardReq struct { URL string; Method string; Headers map[string]string; Query map[string]string; Body any; TimeoutMS int }`
  - `type ForwardResp struct { Type string; TextPath string; ErrorPath string }`
  - `type ForwardOpts struct { IncludeSystem *bool; IncludeHistory *bool; SessionID string; MockStream *bool; MockStreamChunk int; MockStreamDelayMS int }`
  - `type ForwardProbe struct { URL string; Method string; ExpectStatus int }`
  - `func ParseForwardSpec(raw json.RawMessage) (*ForwardSpec, error)` —— 解析+默认值+校验；坏 JSON 带行号
  - `func UsesPlaceholder(raw json.RawMessage, name string) bool` —— Task 5 校验「{{model}} 但模型名为空」用
  - `var phRe *regexp.Regexp`（包内可见，Task 2 复用）—— 匹配 `{{ name }}`（允许空格与 `env:NAME`）
  - `func walkStrings(v any, fn func(string) bool)`（包内可见，Task 1 自己用）

- [ ] **Step 1: 写失败测试 `forward_spec_test.go`**

```go
package llm

import (
	"encoding/json"
	"strings"
	"testing"
)

const minSpec = `{
  "request": {"url": "http://127.0.0.1:3100/api/chat", "method": "POST", "body": {"text": "{{last_user}}"}},
  "response": {"type": "json", "text_path": "reply"}
}`

func TestParseForwardSpecDefaults(t *testing.T) {
	spec, err := ParseForwardSpec(json.RawMessage(minSpec))
	if err != nil {
		t.Fatal(err)
	}
	if spec.Version != 1 || spec.Request.TimeoutMS != 120000 {
		t.Fatalf("version/timeout 默认值错误: %+v", spec.Request)
	}
	if spec.Options.SessionID != "default" || spec.Options.MockStreamChunk != 12 || spec.Options.MockStreamDelayMS != 20 {
		t.Fatalf("options 默认值错误: %+v", spec.Options)
	}
	for name, v := range map[string]*bool{
		"include_system": spec.Options.IncludeSystem, "include_history": spec.Options.IncludeHistory,
		"mock_stream": spec.Options.MockStream,
	} {
		if v == nil || !*v {
			t.Fatalf("%s 默认应为 true", name)
		}
	}
	if spec.Probe != nil {
		t.Fatal("probe 默认应为 nil")
	}
}

func TestParseForwardSpecExplicitFalse(t *testing.T) {
	raw := `{
	  "request": {"url": "http://127.0.0.1:3100/x", "method": "GET"},
	  "response": {"type": "text"},
	  "options": {"include_system": false, "mock_stream": false}
	}`
	spec, err := ParseForwardSpec(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	if *spec.Options.IncludeSystem || *spec.Options.MockStream {
		t.Fatal("显式 false 被默认值覆盖（*bool 三态失效）")
	}
}

func TestParseForwardSpecProbeDefaults(t *testing.T) {
	raw := `{
	  "request": {"url": "http://127.0.0.1:1/x", "method": "GET"},
	  "response": {"type": "text"},
	  "probe": {"url": "http://127.0.0.1:1/status"}
	}`
	spec, err := ParseForwardSpec(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	if spec.Probe.Method != "GET" || spec.Probe.ExpectStatus != 200 {
		t.Fatalf("probe 默认值错误: %+v", spec.Probe)
	}
}

func TestParseForwardSpecErrors(t *testing.T) {
	cases := map[string]string{
		"空配置":      ``,
		"版本不支持":    `{"version": 2}`,
		"缺 url":    `{"request": {"method": "POST"}, "response": {"type": "text"}}`,
		"坏 method": `{"request": {"url": "http://127.0.0.1:1/x", "method": "PATCH"}, "response": {"type": "text"}}`,
		"外网 http":  `{"request": {"url": "http://example.com/x", "method": "GET"}, "response": {"type": "text"}}`,
		"缺 type":   `{"request": {"url": "http://127.0.0.1:1/x", "method": "GET"}}`,
		"json 缺 text_path": `{"request": {"url": "http://127.0.0.1:1/x", "method": "GET"}, "response": {"type": "json"}}`,
		"未知占位符": `{"request": {"url": "http://127.0.0.1:1/x", "method": "GET", "body": {"t": "{{nope}}"}}, "response": {"type": "text"}}`,
		"chunk 为负": `{"request": {"url": "http://127.0.0.1:1/x", "method": "GET"}, "response": {"type": "text"}, "options": {"mock_stream_chunk": -1}}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseForwardSpec(json.RawMessage(raw)); err == nil {
				t.Fatalf("%s 应报错", name)
			}
		})
	}
	// 坏 JSON 的报错要带行号
	_, err := ParseForwardSpec(json.RawMessage("{\n \"request\": {"))
	if err == nil || !strings.Contains(err.Error(), "第 2 行") {
		t.Fatalf("坏 JSON 报错应带行号: %v", err)
	}
}

func TestUsesPlaceholder(t *testing.T) {
	raw := json.RawMessage(`{"request": {"url": "http://127.0.0.1:1/x", "method": "GET", "body": {"t": "{{ model }}"}}, "response": {"type": "text"}}`)
	if !UsesPlaceholder(raw, "model") {
		t.Fatal("{{ model }}（带空格）应被识别")
	}
	if UsesPlaceholder(raw, "last_user") {
		t.Fatal("不存在的占位符不应命中")
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/llm/ -run 'TestParseForwardSpec|TestUsesPlaceholder' -count=1`
Expected: 编译失败（`ParseForwardSpec` 未定义）

- [ ] **Step 3: 实现 `forward_spec.go`**

```go
package llm

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// ForwardSpec 转发连接声明式配置（configstore.Connection.Forward 的解析形状，spec §3.2）。
type ForwardSpec struct {
	Version  int          `json:"version"`
	Request  ForwardReq   `json:"request"`
	Response ForwardResp  `json:"response"`
	Options  ForwardOpts  `json:"options"`
	Probe    *ForwardProbe `json:"probe"`
}

// ForwardReq 请求定义：URL/Method 必填，Body 任意 JSON（值里可用占位符）。
type ForwardReq struct {
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	Query     map[string]string `json:"query"`
	Body      any               `json:"body"`
	TimeoutMS int               `json:"timeout_ms"`
}

// ForwardResp 响应提取定义（type: json | text | ndjson | sse_openai）。
type ForwardResp struct {
	Type      string `json:"type"`
	TextPath  string `json:"text_path"`
	ErrorPath string `json:"error_path"`
}

// ForwardOpts 上下文与流式选项。IncludeSystem/IncludeHistory/MockStream 用 *bool：
// Go 零值是 false，不用指针无法区分「用户写了 false」和「用户没写」（spec §3.2）。
type ForwardOpts struct {
	IncludeSystem     *bool  `json:"include_system"`
	IncludeHistory    *bool  `json:"include_history"`
	SessionID         string `json:"session_id"`
	MockStream        *bool  `json:"mock_stream"`
	MockStreamChunk   int    `json:"mock_stream_chunk"`
	MockStreamDelayMS int    `json:"mock_stream_delay_ms"`
}

// ForwardProbe 「测试连接」打的目标；nil = 只做语法校验。
type ForwardProbe struct {
	URL          string `json:"url"`
	Method       string `json:"method"`
	ExpectStatus int    `json:"expect_status"`
}

// phRe 占位符：{{ name }}，name 允许字母数字下划线冒号点横线（env:NAME 用冒号）。
var phRe = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_:.-]+)\s*\}\}`)

var knownPlaceholders = map[string]bool{
	"last_user": true, "system": true, "messages": true, "history": true,
	"model": true, "session_id": true, "now": true,
}

// ParseForwardSpec 解析 + 默认值填充 + 校验（保存期与探活期共用）。
// 失败返回可读错误；坏 JSON 带行号（json.SyntaxError.Offset 换算）。
func ParseForwardSpec(raw json.RawMessage) (*ForwardSpec, error) {
	if len(raw) == 0 {
		return nil, errors.New("转发配置不能为空")
	}
	s := &ForwardSpec{}
	if err := json.Unmarshal(raw, s); err != nil {
		var se *json.SyntaxError
		if errors.As(err, &se) {
			line := 1 + strings.Count(string(raw[:se.Offset]), "\n")
			return nil, fmt.Errorf("转发配置 JSON 语法错误（第 %d 行）", line)
		}
		return nil, fmt.Errorf("转发配置 JSON 解析失败: %v", err)
	}
	if s.Version == 0 {
		s.Version = 1
	}
	if s.Version != 1 {
		return nil, fmt.Errorf("不支持的转发配置版本: %d（当前仅支持 1）", s.Version)
	}
	s.fillDefaults()
	if err := s.check(); err != nil {
		return nil, err
	}
	return s, nil
}

// fillDefaults 零值字段填默认（*bool 三态：nil 才是默认 true）。
func (s *ForwardSpec) fillDefaults() {
	if s.Request.Method == "" {
		s.Request.Method = http.MethodPost
	}
	if s.Request.TimeoutMS == 0 {
		s.Request.TimeoutMS = 120000
	}
	if s.Options.IncludeSystem == nil {
		t := true
		s.Options.IncludeSystem = &t
	}
	if s.Options.IncludeHistory == nil {
		t := true
		s.Options.IncludeHistory = &t
	}
	if s.Options.MockStream == nil {
		t := true
		s.Options.MockStream = &t
	}
	if s.Options.SessionID == "" {
		s.Options.SessionID = "default"
	}
	if s.Options.MockStreamChunk == 0 {
		s.Options.MockStreamChunk = 12
	}
	if s.Options.MockStreamDelayMS == 0 {
		s.Options.MockStreamDelayMS = 20
	}
	if s.Probe != nil {
		if s.Probe.Method == "" {
			s.Probe.Method = http.MethodGet
		}
		if s.Probe.ExpectStatus == 0 {
			s.Probe.ExpectStatus = 200
		}
	}
}

// check 必填与范围校验；错误文案要能定位字段（spec §9：写错配置是这条路上最常见的故障）。
func (s *ForwardSpec) check() error {
	u, err := url.Parse(s.Request.URL)
	if err != nil || u.Host == "" {
		return errors.New("转发配置 request.url 无效")
	}
	host := u.Hostname()
	local := host == "127.0.0.1" || host == "localhost" || host == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return errors.New("转发配置 request.url 必须为 https（本地端点可用 http）")
	}
	switch s.Request.Method {
	case http.MethodGet, http.MethodPost, http.MethodPut:
	default:
		return errors.New("转发配置 request.method 仅支持 GET/POST/PUT")
	}
	if s.Request.TimeoutMS < 1 {
		return errors.New("转发配置 request.timeout_ms 必须为正数")
	}
	switch s.Response.Type {
	case "json", "ndjson":
		if s.Response.TextPath == "" {
			return fmt.Errorf("转发配置 response.type=%s 时 text_path 必填", s.Response.Type)
		}
	case "text", "sse_openai":
	default:
		return fmt.Errorf("转发配置 response.type 非法: %q（可选: json, text, ndjson, sse_openai）", s.Response.Type)
	}
	if s.Options.MockStreamChunk < 1 {
		return errors.New("转发配置 options.mock_stream_chunk 必须 ≥ 1")
	}
	if s.Options.MockStreamDelayMS < 0 {
		return errors.New("转发配置 options.mock_stream_delay_ms 必须 ≥ 0")
	}
	if s.Probe != nil {
		if s.Probe.URL == "" {
			return errors.New("转发配置 probe.url 必填（或删除整个 probe 块）")
		}
		if s.Probe.ExpectStatus < 100 || s.Probe.ExpectStatus > 599 {
			return errors.New("转发配置 probe.expect_status 超出范围（100..599）")
		}
	}
	if name := firstUnknownPlaceholder(s); name != "" {
		return fmt.Errorf("未知占位符 {{%s}}（可用: last_user, system, messages, history, model, session_id, now, env:NAME）", name)
	}
	return nil
}

// firstUnknownPlaceholder 扫描 request.headers/query/body 里的占位符，返回第一个未知名（无则 ""）。
// env:NAME 一律放行（运行时读环境变量）。
func firstUnknownPlaceholder(s *ForwardSpec) string {
	var unknown string
	check := func(str string) {
		if unknown != "" {
			return
		}
		for _, m := range phRe.FindAllStringSubmatch(str, -1) {
			name := m[1]
			if strings.HasPrefix(name, "env:") || knownPlaceholders[name] {
				continue
			}
			unknown = name
			return
		}
	}
	for _, v := range s.Request.Headers {
		check(v)
	}
	for _, v := range s.Request.Query {
		check(v)
	}
	walkStrings(s.Request.Body, func(str string) bool {
		check(str)
		return true
	})
	return unknown
}

// walkStrings 深度遍历 JSON 值（map 键不遍历），对每个字符串调 fn；fn 返回 false 提前终止。
func walkStrings(v any, fn func(string) bool) {
	switch t := v.(type) {
	case map[string]any:
		for _, item := range t {
			walkStrings(item, fn)
		}
	case []any:
		for _, item := range t {
			walkStrings(item, fn)
		}
	case string:
		fn(t)
	}
}

// UsesPlaceholder raw 配置的字符串值里是否出现指定占位符（含 {{ name }} 空格写法）。
// 供 service 层校验「{{model}} 但模型名为空」。
func UsesPlaceholder(raw json.RawMessage, name string) bool {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return false
	}
	found := false
	walkStrings(v, func(str string) bool {
		for _, m := range phRe.FindAllStringSubmatch(str, -1) {
			if m[1] == name {
				found = true
				return false
			}
		}
		return true
	})
	return found
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/llm/ -run 'TestParseForwardSpec|TestUsesPlaceholder' -count=1`
Expected: PASS

- [ ] **Step 5: 全量回归 + commit**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全绿（本任务纯新增，不影响既有）

```bash
git add server/internal/llm/forward_spec.go server/internal/llm/forward_spec_test.go
git commit -m "feat(llm): 新增转发配置解析与校验（ForwardSpec）"
```

---

### Task 2: 占位符模板渲染

**Files:**
- Create: `server/internal/llm/forward_template.go`
- Modify: `server/internal/llm/provider.go:6-10`（`Message` 加 json tag）
- Test: `server/internal/llm/forward_template_test.go`

**Interfaces:**
- Consumes: `phRe`（Task 1）、`Message`（provider.go）
- Produces:
  - `type placeholderCtx struct { LastUser, System, Model, SessionID, Now string; Messages, History []Message }`
  - `func newPlaceholderCtx(sys, lastUser string, eff, history []Message, model, sessionID string) placeholderCtx` —— Now 取当前毫秒时间戳
  - `func renderBody(v any, ctx placeholderCtx) (any, error)` —— 递归：map/slice 递归、string 调 renderString、其余原样；**map 键不渲染**
  - `func renderString(s string, ctx placeholderCtx) (any, error)` —— 整串占位符返回原始类型；部分匹配字符串拼接；未知名报错；嵌入非字符串值报错

- [ ] **Step 1: `Message` 加 json tag（`{{messages}}` 需序列化成 `{"role":..,"content":..}` 形状，spec §4.5）**

`server/internal/llm/provider.go:6-10` 改为：

```go
// Message 一条对话消息（Role: system | user | assistant）。
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
```

- [ ] **Step 2: 写失败测试 `forward_template_test.go`**

```go
package llm

import (
	"encoding/json"
	"testing"
)

func ctxFor(t *testing.T) placeholderCtx {
	t.Helper()
	return placeholderCtx{
		LastUser: "你好", System: "你是桌宠",
		Messages: []Message{{Role: "system", Content: "你是桌宠"}, {Role: "user", Content: "你好"}},
		History:  []Message{{Role: "assistant", Content: "既往回复"}},
		Model: "m1", SessionID: "pet", Now: "123",
	}
}

func TestRenderWholePlaceholderRawType(t *testing.T) {
	body := map[string]any{"messages": "{{messages}}"}
	out, err := renderBody(body, ctxFor(t))
	if err != nil {
		t.Fatal(err)
	}
	msgs, ok := out.(map[string]any)["messages"].([]Message)
	if !ok || len(msgs) != 2 {
		t.Fatalf("整串占位符应渲染为原始 []Message: %#v", out)
	}
	raw, _ := json.Marshal(msgs)
	if string(raw) != `[{"role":"system","content":"你是桌宠"},{"role":"user","content":"你好"}]` {
		t.Fatalf("[]Message 序列化形状错误: %s", raw)
	}
}

func TestRenderEmbeddedPlaceholderConcat(t *testing.T) {
	out, err := renderString("用户说：{{last_user}}", ctxFor(t))
	if err != nil || out != "用户说：你好" {
		t.Fatalf("嵌入拼接错误: %v %v", out, err)
	}
}

func TestRenderEnvPlaceholder(t *testing.T) {
	t.Setenv("LB_TEST_TOKEN", "tk-1")
	out, err := renderString("{{env:LB_TEST_TOKEN}}", ctxFor(t))
	if err != nil || out != "tk-1" {
		t.Fatalf("env 占位符错误: %v %v", out, err)
	}
}

func TestRenderUnknownPlaceholderErrors(t *testing.T) {
	if _, err := renderString("{{nope}}", ctxFor(t)); err == nil {
		t.Fatal("未知名应报错")
	}
	if _, err := renderString("前缀{{nope}}后缀", ctxFor(t)); err == nil {
		t.Fatal("嵌入未知名应报错")
	}
}

func TestRenderMapKeyNotRendered(t *testing.T) {
	out, err := renderBody(map[string]any{"{{last_user}}": "v"}, ctxFor(t))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := out.(map[string]any)["{{last_user}}"]; !ok {
		t.Fatal("map 键不应被渲染")
	}
}

func TestRenderEmbeddedRawTypeErrors(t *testing.T) {
	if _, err := renderString("历史：{{messages}}", ctxFor(t)); err == nil {
		t.Fatal("嵌入数组占位符应报错")
	}
}

func TestRenderNestedArray(t *testing.T) {
	body := map[string]any{"list": []any{"a{{last_user}}", "{{system}}"}}
	out, err := renderBody(body, ctxFor(t))
	if err != nil {
		t.Fatal(err)
	}
	list := out.(map[string]any)["list"].([]any)
	if list[0] != "a你好" || list[1] != "你是桌宠" {
		t.Fatalf("嵌套数组渲染错误: %#v", list)
	}
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd server && go test ./internal/llm/ -run TestRender -count=1`
Expected: 编译失败（`placeholderCtx` 未定义）

- [ ] **Step 4: 实现 `forward_template.go`**

```go
package llm

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// placeholderCtx 渲染上下文：占位符取值来源（spec §4.5）。
type placeholderCtx struct {
	LastUser  string
	System    string
	Messages  []Message
	History   []Message
	Model     string
	SessionID string
	Now       string
}

// newPlaceholderCtx 组装渲染上下文；Now = 当前毫秒时间戳。
func newPlaceholderCtx(sys, lastUser string, eff, history []Message, model, sessionID string) placeholderCtx {
	return placeholderCtx{
		LastUser: lastUser, System: sys, Messages: eff, History: history,
		Model: model, SessionID: sessionID,
		Now: strconv.FormatInt(time.Now().UnixMilli(), 10),
	}
}

// renderBody 递归渲染任意 JSON：map/slice 递归（键不渲染），string 调 renderString，其余原样。
func renderBody(v any, ctx placeholderCtx) (any, error) {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, item := range t {
			r, err := renderBody(item, ctx)
			if err != nil {
				return nil, err
			}
			out[k] = r
		}
		return out, nil
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			r, err := renderBody(item, ctx)
			if err != nil {
				return nil, err
			}
			out[i] = r
		}
		return out, nil
	case string:
		return renderString(t, ctx)
	default:
		return v, nil
	}
}

// renderString 两条规则（spec §4.5）：
//   整串恰好是一个占位符 → 返回原始类型（数组还是数组）
//   占位符嵌在字符串里 → 字符串拼接（值为非字符串时报错）
func renderString(s string, ctx placeholderCtx) (any, error) {
	trimmed := strings.TrimSpace(s)
	if m := phRe.FindStringSubmatchIndex(trimmed); m != nil && m[0] == 0 && m[1] == len(trimmed) {
		return valueOf(trimmed[m[2]:m[3]], ctx)
	}
	var firstErr error
	out := phRe.ReplaceAllStringFunc(s, func(tok string) string {
		m := phRe.FindStringSubmatch(tok)
		v, err := valueOf(m[1], ctx)
		if err != nil && firstErr == nil {
			firstErr = err
			return tok
		}
		str, ok := v.(string)
		if !ok {
			if firstErr == nil {
				firstErr = fmt.Errorf("占位符 %s 的值为非字符串，不能嵌入拼接", tok)
			}
			return tok
		}
		return str
	})
	if firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

// valueOf 占位符取值；未知名报错（env: 前缀读环境变量）。
func valueOf(name string, ctx placeholderCtx) (any, error) {
	switch name {
	case "last_user":
		return ctx.LastUser, nil
	case "system":
		return ctx.System, nil
	case "messages":
		return ctx.Messages, nil
	case "history":
		return ctx.History, nil
	case "model":
		return ctx.Model, nil
	case "session_id":
		return ctx.SessionID, nil
	case "now":
		return ctx.Now, nil
	default:
		if v, ok := strings.CutPrefix(name, "env:"); ok {
			return os.Getenv(v), nil
		}
		return nil, fmt.Errorf("未知占位符 {{%s}}（可用: last_user, system, messages, history, model, session_id, now, env:NAME）", name)
	}
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && go test ./internal/llm/ -run TestRender -count=1`
Expected: PASS

- [ ] **Step 6: 全量回归 + commit**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全绿

```bash
git add server/internal/llm/forward_template.go server/internal/llm/forward_template_test.go server/internal/llm/provider.go
git commit -m "feat(llm): 新增转发占位符模板渲染"
```

---

### Task 3: 响应路径提取

**Files:**
- Create: `server/internal/llm/forward_extract.go`
- Test: `server/internal/llm/forward_extract_test.go`

**Interfaces:**
- Consumes: 无
- Produces:
  - `func ExtractPath(root any, path string) (string, error)` —— 支持 `reply` / `data.text` / `choices[0].message.content` / `data.items[0].content`；string 原样、json.Number/float64 转字符串、nil 报「命中 null」、复合类型报「命中非文本」、越界报「越界（长度 N）」、空段报「有空段」

- [ ] **Step 1: 写失败测试 `forward_extract_test.go`**

```go
package llm

import (
	"encoding/json"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, s string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestExtractPathForms(t *testing.T) {
	root := mustJSON(t, `{"reply":"ok","data":{"text":"嵌套","items":[{"content":"数组"}]},"num":42}`)
	cases := map[string]string{
		"reply":                 "ok",
		"data.text":             "嵌套",
		"data.items[0].content": "数组",
	}
	for path, want := range cases {
		got, err := ExtractPath(root, path)
		if err != nil || got != want {
			t.Fatalf("%s = %q, %v; want %q", path, got, err, want)
		}
	}
	if got, err := ExtractPath(root, "num"); err != nil || got != "42" {
		t.Fatalf("数字应转字符串: %q %v", got, err)
	}
}

func TestExtractPathErrors(t *testing.T) {
	root := mustJSON(t, `{"a":{"b":null},"arr":[1]}`)
	for name, tc := range map[string]struct{ path, frag string }{
		"缺键":    {"a.c", "不存在"},
		"命中 null": {"a.b", "null"},
		"命中对象":  {"a", "非文本"},
		"越界":    {"arr[3]", "越界"},
		"非法段":   {"a..b", "空段"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ExtractPath(root, tc.path)
			if err == nil || !strings.Contains(err.Error(), tc.frag) {
				t.Fatalf("err = %v; 应含 %q", err, tc.frag)
			}
		})
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/llm/ -run TestExtractPath -count=1`
Expected: 编译失败（`ExtractPath` 未定义）

- [ ] **Step 3: 实现 `forward_extract.go`**

```go
package llm

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var segRe = regexp.MustCompile(`^([^\[\]]+)((?:\[\d+\])*)$`)
var idxRe = regexp.MustCompile(`\[\d+\]`)

// ExtractPath 按点路径从解析后的 JSON 取值（spec §4.6）：
//   reply / data.text / choices[0].message.content / data.items[0].content
// 命中的值必须是 string / json.Number / float64；nil 或复合类型报错。
// 报错要带失败段位置——配置写错是这条路上最常见的故障。
func ExtractPath(root any, path string) (string, error) {
	cur := root
	for _, seg := range strings.Split(path, ".") {
		if seg == "" {
			return "", fmt.Errorf("路径 %q 有空段", path)
		}
		m := segRe.FindStringSubmatch(seg)
		if m == nil {
			return "", fmt.Errorf("路径 %q 的段 %q 非法", path, seg)
		}
		key := m[1]
		obj, ok := cur.(map[string]any)
		if !ok {
			return "", fmt.Errorf("路径 %q 在 %q 处命中非对象（实际类型 %T）", path, key, cur)
		}
		cur, ok = obj[key]
		if !ok {
			return "", fmt.Errorf("路径 %q 未命中：%q 不存在", path, key)
		}
		for _, idxStr := range idxRe.FindAllString(m[2], -1) {
			idx, _ := strconv.Atoi(strings.Trim(idxStr, "[]"))
			arr, ok := cur.([]any)
			if !ok {
				return "", fmt.Errorf("路径 %q 在 %q 处命中非数组（实际类型 %T）", path, key, cur)
			}
			if idx >= len(arr) {
				return "", fmt.Errorf("路径 %q 在 %q[%d] 处越界（长度 %d）", path, key, idx, len(arr))
			}
			cur = arr[idx]
		}
	}
	switch v := cur.(type) {
	case string:
		return v, nil
	case json.Number:
		return v.String(), nil
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), nil
	case nil:
		return "", fmt.Errorf("路径 %q 命中 null", path)
	default:
		return "", fmt.Errorf("路径 %q 命中非文本值（实际类型 %T），检查 text_path", path, cur)
	}
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/llm/ -run TestExtractPath -count=1`
Expected: PASS

- [ ] **Step 5: 全量回归 + commit**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全绿

```bash
git add server/internal/llm/forward_extract.go server/internal/llm/forward_extract_test.go
git commit -m "feat(llm): 新增转发响应路径提取（ExtractPath）"
```

---

### Task 4: ForwardProvider 核心

**Files:**
- Create: `server/internal/llm/forward.go`
- Test: `server/internal/llm/forward_test.go`

**Interfaces:**
- Consumes: `ChatProvider`/`Message`/`StreamEvent`（provider.go）、`ParseForwardSpec`/`ForwardSpec`/`phRe`（Task 1）、`placeholderCtx`/`newPlaceholderCtx`/`renderBody`/`renderString`（Task 2）、`ExtractPath`（Task 3）
- Produces:
  - `func NewForward(raw json.RawMessage, model string) (*ForwardProvider, error)`
  - `(*ForwardProvider) Configured() bool`（spec != nil，绕过 chat.go 的未配置拦截）、`KeyEnv() string`（""）、`StreamChat(ctx, msgs) <-chan StreamEvent`
  - 包内：`applyOptions(msgs, opts) []Message`、`split(eff) (system, lastUser string, history []Message)`、`emitChunked`、`sleepCtx`、`send`、`errText`

- [ ] **Step 1: 写失败测试 `forward_test.go`**

```go
package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// forwardSpec 造一个指向指定 URL 的 json 类型 provider：chunk 2、延迟 0（测试快）。
func forwardSpec(t *testing.T, url string) *ForwardProvider {
	t.Helper()
	raw := fmt.Sprintf(`{
	  "request": {"url": "%s", "method": "POST",
	    "body": {"text": "{{last_user}}", "system": "{{system}}", "messages": "{{messages}}"},
	    "timeout_ms": 5000},
	  "response": {"type": "json", "text_path": "reply"},
	  "options": {"mock_stream_chunk": 2, "mock_stream_delay_ms": 0}
	}`, url)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func collect(t *testing.T, p *ForwardProvider, msgs []Message) (string, []string) {
	t.Helper()
	var deltas []string
	for ev := range p.StreamChat(context.Background(), msgs) {
		if ev.Err != nil {
			t.Fatalf("流错误: %v", ev.Err)
		}
		deltas = append(deltas, ev.Delta)
	}
	return strings.Join(deltas, ""), deltas
}

func TestForwardJSONChunkedChinese(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"reply":"你好世界"}`)
	}))
	t.Cleanup(srv.Close)
	full, deltas := collect(t, forwardSpec(t, srv.URL), []Message{{Role: "user", Content: "hi"}})
	if full != "你好世界" || len(deltas) != 2 {
		t.Fatalf("full=%q deltas=%v; 期望按 rune 切 2 段不乱码", full, deltas)
	}
}

func TestForwardTextTypeNoMockStream(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "纯文本回复")
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{"request": {"url": "%s", "method": "GET"}, "response": {"type": "text"}, "options": {"mock_stream": false}}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	full, deltas := collect(t, p, []Message{{Role: "user", Content: "hi"}})
	if full != "纯文本回复" || len(deltas) != 1 {
		t.Fatalf("mock_stream=false 应整段一次推: %q %v", full, deltas)
	}
}

func TestForwardNDJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "{\"reply\":\"第一段\"}\n{\"reply\":\"第二段\"}\n")
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{"request": {"url": "%s", "method": "GET"}, "response": {"type": "ndjson", "text_path": "reply"}}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	full, deltas := collect(t, p, []Message{{Role: "user", Content: "hi"}})
	if full != "第一段第二段" || len(deltas) != 2 {
		t.Fatalf("ndjson 应每行一段: %q %v", full, deltas)
	}
}

func TestForwardSSEOpenAI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{"request": {"url": "%s", "method": "GET"}, "response": {"type": "sse_openai"}}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	full, deltas := collect(t, p, []Message{{Role: "user", Content: "hi"}})
	if full != "你好" || len(deltas) != 2 {
		t.Fatalf("sse_openai 应逐 delta 推: %q %v", full, deltas)
	}
}

func TestForwardIncludeSystemFalse(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		fmt.Fprint(w, `{"reply":"ok"}`)
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{
	  "request": {"url": "%s", "method": "POST", "body": {"system": "{{system}}", "messages": "{{messages}}"}, "timeout_ms": 5000},
	  "response": {"type": "json", "text_path": "reply"},
	  "options": {"include_system": false, "mock_stream": false}
	}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	msgs := []Message{{Role: "system", Content: "人设"}, {Role: "user", Content: "hi"}}
	if full, _ := collect(t, p, msgs); full != "ok" {
		t.Fatalf("回复应为 ok: %q", full)
	}
	var body map[string]any
	_ = json.Unmarshal(gotBody, &body)
	if body["system"] != "" {
		t.Fatalf("include_system=false 时 {{system}} 应为空串: %#v", body["system"])
	}
	msgsArr, ok := body["messages"].([]any)
	if !ok || len(msgsArr) != 1 || msgsArr[0].(map[string]any)["role"] != "user" {
		t.Fatalf("{{messages}} 不应含 system 条目: %#v", body["messages"])
	}
}

func TestForwardIncludeHistoryFalse(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		fmt.Fprint(w, `{"reply":"ok"}`)
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{
	  "request": {"url": "%s", "method": "POST", "body": {"history": "{{history}}", "last_user": "{{last_user}}"}, "timeout_ms": 5000},
	  "response": {"type": "json", "text_path": "reply"},
	  "options": {"include_history": false, "mock_stream": false}
	}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	msgs := []Message{
		{Role: "system", Content: "人设"}, {Role: "user", Content: "第一句"},
		{Role: "assistant", Content: "回复"}, {Role: "user", Content: "第二句"},
	}
	if full, _ := collect(t, p, msgs); full != "ok" {
		t.Fatalf("回复应为 ok: %q", full)
	}
	var body map[string]any
	_ = json.Unmarshal(gotBody, &body)
	if body["last_user"] != "第二句" {
		t.Fatalf("last_user 应为最后一条 user: %#v", body["last_user"])
	}
	if hist, ok := body["history"].([]any); !ok || len(hist) != 0 {
		t.Fatalf("include_history=false 时 {{history}} 应为空数组: %#v", body["history"])
	}
}

func TestForwardNon2xxErrorPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		fmt.Fprint(w, `{"error":{"message":"内部炸了"}}`)
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{"request": {"url": "%s", "method": "GET"}, "response": {"type": "json", "text_path": "reply", "error_path": "error.message"}}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	var gotErr error
	for ev := range p.StreamChat(context.Background(), []Message{{Role: "user", Content: "hi"}}) {
		if ev.Err != nil {
			gotErr = ev.Err
		}
	}
	if gotErr == nil || !strings.Contains(gotErr.Error(), "内部炸了") {
		t.Fatalf("应抠出 error_path 文案: %v", gotErr)
	}
}

func TestForwardCtxCancelStops(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"reply":"这是一段足够长的回复用来测试取消即时生效"}`)
	}))
	t.Cleanup(srv.Close)
	raw := fmt.Sprintf(`{
	  "request": {"url": "%s", "method": "GET"},
	  "response": {"type": "json", "text_path": "reply"},
	  "options": {"mock_stream_chunk": 1, "mock_stream_delay_ms": 100}
	}`, srv.URL)
	p, err := NewForward(json.RawMessage(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	ch := p.StreamChat(ctx, []Message{{Role: "user", Content: "hi"}})
	<-ch // 收第一块后取消
	cancel()
	done := make(chan struct{})
	go func() {
		for range ch {
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("ctx 取消后 500ms 内应关闭通道")
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/llm/ -run TestForward -count=1`
Expected: 编译失败（`NewForward` 未定义）

- [ ] **Step 3: 实现 `forward.go`**

```go
package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxForwardBody = 8 << 20 // 8 MB：响应体上限（spec §4.8）

// ForwardProvider 声明式 HTTP 转发：OpenAI 形状消息 → 裁剪 → 模板渲染 → HTTP → 路径提取 → 流式事件。
// 不存任何状态——转发层一旦存东西就变成第二个脑（spec §1.2）。
type ForwardProvider struct {
	spec   *ForwardSpec
	client *http.Client
	model  string
}

// NewForward 解析 raw 配置并构建。model 供 {{model}} 占位符，可为空（service 层校验依赖关系）。
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

// StreamChat 一次转发对话（spec §4.3）：裁剪 → 拆分 → 渲染 → 请求 → 按 type 读响应 → 推事件。
// ctx 取消时静默关通道（与 OpenAICompat 一致：ctx.Err() == nil 才推 Err）。
func (p *ForwardProvider) StreamChat(ctx context.Context, msgs []Message) <-chan StreamEvent {
	ch := make(chan StreamEvent)
	go func() {
		defer close(ch)
		eff := applyOptions(msgs, p.spec.Options)
		sys, lastUser, history := split(eff)
		phCtx := newPlaceholderCtx(sys, lastUser, eff, history, p.model, p.spec.Options.SessionID)
		body, err := renderBody(p.spec.Request.Body, phCtx)
		if err != nil {
			ch <- StreamEvent{Err: err}
			return
		}
		resp, err := p.do(ctx, phCtx, body)
		if err != nil {
			if ctx.Err() == nil {
				ch <- StreamEvent{Err: fmt.Errorf("转发失败: %w", err)}
			}
			return
		}
		defer resp.Body.Close()
		if err := p.emit(ctx, resp, ch); err != nil && ctx.Err() == nil {
			ch <- StreamEvent{Err: err}
		}
	}()
	return ch
}

// applyOptions 按 include_system / include_history 裁剪消息。
// 裁剪必须作用在 msgs 上而不是各占位符上（spec §4.3），否则 {{system}} 与 {{messages}} 语义打架。
func applyOptions(msgs []Message, o ForwardOpts) []Message {
	eff := make([]Message, 0, len(msgs))
	for _, m := range msgs {
		if m.Role == "system" && !*o.IncludeSystem {
			continue
		}
		eff = append(eff, m)
	}
	if !*o.IncludeHistory {
		out := make([]Message, 0, 2)
		for _, m := range eff {
			if m.Role == "system" {
				out = append(out, m)
			}
		}
		if last := lastUserOf(eff); last != nil {
			out = append(out, *last)
		}
		return out
	}
	return eff
}

// lastUserOf 从后往前找最后一条 user（无则 nil）。
func lastUserOf(msgs []Message) *Message {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			return &msgs[i]
		}
	}
	return nil
}

// split 拆分 eff：system = 第一条 system 的 Content（无则 ""）；lastUser = 最后一条 user 的 Content；
// history = eff 去掉第一条 system 与最后一条 user 后的剩余（spec §4.3）。
// 实现：先定位 lastUser 下标，再单次遍历跳过首条 system 与 lastUser。
func split(eff []Message) (system, lastUser string, history []Message) {
	for _, m := range eff {
		if m.Role == "system" {
			system = m.Content
			break
		}
	}
	lastIdx := -1
	for i := len(eff) - 1; i >= 0; i-- {
		if eff[i].Role == "user" {
			lastIdx = i
			lastUser = eff[i].Content
			break
		}
	}
	systemSkipped := false
	for i, m := range eff {
		if m.Role == "system" && !systemSkipped {
			systemSkipped = true
			continue
		}
		if i == lastIdx {
			continue
		}
		history = append(history, m)
	}
	return system, lastUser, history
}
```

- [ ] **Step 4: 继续实现 `forward.go` 的请求与响应部分（追加到同一文件）**

```go
// do 组装并发出请求：URL + query + headers + body（渲染后）。非 2xx 尝试 error_path（spec §4.8）。
func (p *ForwardProvider) do(ctx context.Context, phCtx placeholderCtx, body any) (*http.Response, error) {
	req := p.spec.Request
	u, err := url.Parse(req.URL)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	for k, v := range req.Query {
		rv, err := renderString(v, phCtx)
		if err != nil {
			return nil, err
		}
		q.Set(k, rv.(string))
	}
	u.RawQuery = q.Encode()

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, u.String(), reader)
	if err != nil {
		return nil, err
	}
	for k, v := range req.Headers {
		rv, err := renderString(v, phCtx)
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set(k, rv.(string))
	}
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxForwardBody))
		if msg, ok := errText(raw, req.Response.ErrorPath); ok {
			return nil, fmt.Errorf("后端返回 %d: %s", resp.StatusCode, msg)
		}
		trunc := raw
		if len(trunc) > 512 {
			trunc = trunc[:512]
		}
		return nil, fmt.Errorf("后端返回 %d: %s", resp.StatusCode, trunc)
	}
	return resp, nil
}

// errText 非 2xx 时按 error_path 抠错误文案；路径未命中/非 JSON 返回 ok=false。
func errText(raw []byte, path string) (string, bool) {
	if path == "" {
		return "", false
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return "", false
	}
	s, err := ExtractPath(root, path)
	if err != nil {
		return "", false
	}
	return s, true
}

// emit 按 response.type 读响应并推事件（spec §4.7 四种类型）。
func (p *ForwardProvider) emit(ctx context.Context, resp *http.Response, ch chan<- StreamEvent) error {
	typ := p.spec.Response.Type
	switch typ {
	case "json", "text":
		raw, err := io.ReadAll(io.LimitReader(resp.Body, maxForwardBody+1))
		if err != nil {
			return fmt.Errorf("读响应失败: %w", err)
		}
		if len(raw) > maxForwardBody {
			return fmt.Errorf("响应体超过 8 MB，text_path 可能写错（把整个 JSON 当文本取了）")
		}
		text, err := p.extractText(typ, raw)
		if err != nil {
			return err
		}
		if !*p.spec.Options.MockStream {
			return send(ctx, ch, StreamEvent{Delta: text})
		}
		return p.emitChunked(ctx, text, ch)
	case "ndjson":
		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
		for sc.Scan() {
			line := sc.Text()
			if strings.TrimSpace(line) == "" {
				continue
			}
			text, err := p.extractText("json", []byte(line))
			if err != nil {
				return err
			}
			if err := send(ctx, ch, StreamEvent{Delta: text}); err != nil {
				return err
			}
		}
		return sc.Err()
	case "sse_openai":
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			line := sc.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data: "))
			if data == "[DONE]" {
				return nil
			}
			var ev struct {
				Choices []struct {
					Delta struct {
						Content string `json:"content"`
					} `json:"delta"`
				} `json:"choices"`
			}
			if err := json.Unmarshal([]byte(data), &ev); err != nil {
				continue // 非目标 JSON 帧（如 usage）跳过，不中断流
			}
			if len(ev.Choices) > 0 && ev.Choices[0].Delta.Content != "" {
				if err := send(ctx, ch, StreamEvent{Delta: ev.Choices[0].Delta.Content}); err != nil {
					return err
				}
			}
		}
		return sc.Err()
	default:
		return fmt.Errorf("未知响应类型: %s", typ)
	}
}

// extractText json 类型走 ExtractPath；text 类型整 body 当文本。
func (p *ForwardProvider) extractText(typ string, raw []byte) (string, error) {
	if typ == "text" {
		return string(raw), nil
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return "", fmt.Errorf("响应不是合法 JSON: %v", err)
	}
	return ExtractPath(root, p.spec.Response.TextPath)
}

// emitChunked 按 rune 切块模拟流式（spec §4.7：按 rune 不按 byte，中文不乱码）；
// sleepCtx 保证「停止」即时生效（spec §4.7）。
func (p *ForwardProvider) emitChunked(ctx context.Context, text string, ch chan<- StreamEvent) error {
	runes := []rune(text)
	n := p.spec.Options.MockStreamChunk
	for i := 0; i < len(runes); i += n {
		end := i + n
		if end > len(runes) {
			end = len(runes)
		}
		if err := send(ctx, ch, StreamEvent{Delta: string(runes[i:end])}); err != nil {
			return err
		}
		if err := p.sleepCtx(ctx); err != nil {
			return err
		}
	}
	return nil
}

// sleepCtx 可中断延迟：time.Sleep 会让「停止」等整段推完才响应。
func (p *ForwardProvider) sleepCtx(ctx context.Context) error {
	select {
	case <-time.After(time.Duration(p.spec.Options.MockStreamDelayMS) * time.Millisecond):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// send 带 ctx 检查的事件发送。
func send(ctx context.Context, ch chan<- StreamEvent, ev StreamEvent) error {
	select {
	case ch <- ev:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && go test ./internal/llm/ -run TestForward -count=1`
Expected: PASS（8 个用例全过）

- [ ] **Step 6: 全量回归 + commit**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全绿

```bash
git add server/internal/llm/forward.go server/internal/llm/forward_test.go
git commit -m "feat(llm): 新增转发 provider 核心（裁剪/渲染/四响应类型/分块流式）"
```

---

### Task 5: configstore + service + controller 接线

**Files:**
- Modify: `server/internal/configstore/configstore.go:19-28`（Connection 加 Forward）
- Modify: `server/internal/service/config.go`（ConnInput/TestInput/ConnectionOut/state/Validate/validateForward/Test/swapActive/newConn/Update/toTestInput/dedup）
- Modify: `server/internal/controller/config.go:31-33,48-50`（Add/Update 预检透传 Forward）
- Test: `server/internal/service/config_test.go`（追加）、`server/internal/controller/config_test.go`（追加）

**Interfaces:**
- Consumes: `llm.NewForward`（Task 4）、`llm.ParseForwardSpec`、`llm.UsesPlaceholder`（Task 1）、`newSvc` 测试助手（已存在）
- Produces:
  - `ConfigService` 支持 `provider == "forward"` 的完整生命周期：保存/更新/删除/激活/测试/热切换
  - `ConnectionOut.Forward json.RawMessage`（编辑回填用，omitempty）

- [ ] **Step 1: `configstore.Connection` 加字段**

`server/internal/configstore/configstore.go:19-28` 改为（`encoding/json` 已导入）：

```go
type Connection struct {
	ID        string          `json:"id"`
	Provider  string          `json:"provider"` // llm.Providers 的键（deepseek/dashscope/zhipu/moonshot）或 "forward"
	BaseURL   string          `json:"base_url"`   // 空 = 厂商默认地址
	Model     string          `json:"model"`      // 空 = 厂商默认模型
	MaxTokens int             `json:"max_tokens"` // 0 = 不传（上游默认）
	APIKey    string          `json:"api_key"`
	Forward   json.RawMessage `json:"forward,omitempty"` // 仅 provider=="forward"；声明式转发配置（llm.ForwardSpec）
	LastCheck *time.Time      `json:"last_check"`
	CheckFail bool            `json:"check_fail"`
}
```

- [ ] **Step 2: `service/config.go` 输入输出结构加 Forward**

imports 加 `"encoding/json"`、`"fmt"`、`"net/http"`（`errors` 已有）。

`ConnInput`（`config.go:27-35`）与 `TestInput`（`:39-46`）各加一行：

```go
	Forward   json.RawMessage `json:"forward"` // provider=="forward" 时的声明式配置
```

`ConnectionOut`（`:49-60`）加：

```go
	Forward   json.RawMessage `json:"forward,omitempty"` // 回传原文供编辑回填；不含密钥（令牌走 {{env:}}）
```

`state()`（`:96-106`）的 ConnectionOut 字面量加 `Forward: c.Forward,`。

- [ ] **Step 3: Validate 分支 + validateForward**

`Validate`（`config.go:110`）函数体开头加：

```go
func Validate(in TestInput) error {
	if in.Provider == "forward" {
		return validateForward(in.Forward, in.Model)
	}
	// ……原有逻辑不动
```

文件末尾（`toTestInput` 附近）加：

```go
// validateForward 转发连接的保存/测试校验（spec §4.4）：配置语法 + {{model}} 依赖。
// 不复用厂商表检查——"forward" 不在 llm.Providers 里（spec §4.4：加进去会让 llm.New 用空 BaseURL 建客户端）。
func validateForward(raw json.RawMessage, model string) error {
	if _, err := llm.ParseForwardSpec(raw); err != nil {
		return err
	}
	if model == "" && llm.UsesPlaceholder(raw, "model") {
		return errors.New("转发配置用到了 {{model}} 但模型名为空")
	}
	return nil
}
```

- [ ] **Step 4: Test 分支（探活）**

`Test`（`config.go:217`）在 `if err := Validate(input); err != nil {…}` 之后、`key := input.APIKey` 之前插入：

```go
	if input.Provider == "forward" {
		return s.testForward(input)
	}
```

文件末尾加（spec §4.9：不能复用 max_tokens:1 + 10 秒路径，代理型后端跑一轮要几十秒必然假失败）：

```go
// testForward 转发探活：有 probe 打 probe，无 probe 只做语法校验（spec §4.9）。
func (s *ConfigService) testForward(input TestInput) TestResult {
	spec, err := llm.ParseForwardSpec(input.Forward)
	if err != nil {
		return TestResult{OK: false, Error: err.Error()}
	}
	if spec.Probe == nil {
		return TestResult{OK: true} // LatencyMS 0 → 前端显示「配置合法（未配置探活地址）」
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.testTimeout)
	defer cancel()
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, spec.Probe.Method, spec.Probe.URL, nil)
	if err != nil {
		return TestResult{OK: false, Error: "探活地址无效: " + err.Error()}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return TestResult{OK: false, Error: "探活失败: " + err.Error()}
	}
	resp.Body.Close()
	if resp.StatusCode != spec.Probe.ExpectStatus {
		return TestResult{OK: false, Error: fmt.Sprintf("探活失败: HTTP %d（期望 %d）", resp.StatusCode, spec.Probe.ExpectStatus)}
	}
	return TestResult{OK: true, LatencyMS: time.Since(start).Milliseconds()}
}
```

- [ ] **Step 5: swapActive / newConn / Update / toTestInput / dedup**

`swapActive`（`config.go:316`）在 `active == nil` 分支之后加：

```go
	if active.Provider == "forward" {
		p, err := llm.NewForward(active.Forward, active.Model)
		if err != nil {
			slog.Warn("激活连接无效，回退默认", "err", err)
			s.reg.Swap(s.fallback)
			return
		}
		s.reg.Swap(p)
		return
	}
```

`newConn`（`config.go:292-299`）的 Connection 字面量加 `Forward: input.Forward,`。

`Update`（`config.go:174`）改为：

```go
	c.Provider, c.BaseURL, c.Model, c.MaxTokens, c.Forward = input.Provider, input.BaseURL, input.Model, input.MaxTokens, input.Forward
```

`toTestInput`（`config.go:331-333`）改为：

```go
func toTestInput(in ConnInput) TestInput {
	return TestInput{Provider: in.Provider, BaseURL: in.BaseURL, Model: in.Model, APIKey: in.APIKey, MaxTokens: in.MaxTokens, Forward: in.Forward}
}
```

`Add` 的查重条件（`config.go:149-150`）改为（forward 连接 BaseURL/Model/APIKey 全空，不比较 Forward 会永远判重）：

```go
		if c.Provider == input.Provider && c.BaseURL == input.BaseURL &&
			c.Model == input.Model && c.APIKey == input.APIKey &&
			string(c.Forward) == string(input.Forward) {
```

- [ ] **Step 6: controller 预检透传**

`server/internal/controller/config.go` 两处（Add `:31-33`、Update `:48-50`）的 TestInput 字面量各加 `Forward: req.Forward,`：

```go
	if err := service.Validate(service.TestInput{
		Provider: req.Provider, BaseURL: req.BaseURL, Model: req.Model, APIKey: req.APIKey, MaxTokens: req.MaxTokens, Forward: req.Forward,
	}); err != nil {
```

（`Test` handler `:79-90` 直接把 `req` 传进 `Validate`/`Test`，TestInput 加了字段后自动生效，不改。）

- [ ] **Step 7: 写 service 层测试（追加到 `config_test.go` 末尾）**

```go
const fwdSpec = `{"request":{"url":"http://127.0.0.1:1/x","method":"GET"},"response":{"type":"text"}}`

func TestForwardAddSwapAndState(t *testing.T) {
	svc, _ := newSvc(t)
	state, err := svc.Add(ConnInput{Provider: "forward", Forward: json.RawMessage(fwdSpec)})
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Connections) != 1 || len(state.Connections[0].Forward) == 0 {
		t.Fatalf("forward 应落盘并回传: %+v", state.Connections)
	}
	if _, ok := svc.reg.Current().(*llm.ForwardProvider); !ok {
		t.Fatalf("激活连接应为 ForwardProvider: %T", svc.reg.Current())
	}
}

func TestForwardDedupByConfig(t *testing.T) {
	svc, _ := newSvc(t)
	rawA := json.RawMessage(`{"request":{"url":"http://127.0.0.1:1/a","method":"GET"},"response":{"type":"text"}}`)
	rawB := json.RawMessage(`{"request":{"url":"http://127.0.0.1:1/b","method":"GET"},"response":{"type":"text"}}`)
	if _, err := svc.Add(ConnInput{Provider: "forward", Forward: rawA}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Add(ConnInput{Provider: "forward", Forward: rawB}); err != nil {
		t.Fatalf("不同转发配置不应判重: %v", err)
	}
	if _, err := svc.Add(ConnInput{Provider: "forward", Forward: rawA}); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("相同转发配置应判重: %v", err)
	}
}

func TestForwardValidateErrors(t *testing.T) {
	cases := map[string]TestInput{
		"空配置": {Provider: "forward"},
		"用 model 无模型名": {Provider: "forward", Forward: json.RawMessage(
			`{"request":{"url":"http://127.0.0.1:1/x","method":"GET","body":{"m":"{{model}}"}},"response":{"type":"text"}}`)},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			if err := Validate(in); err == nil {
				t.Fatalf("%s 应报错", name)
			}
		})
	}
}

func TestForwardTestProbe(t *testing.T) {
	svc, _ := newSvc(t)
	probe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(probe.Close)

	ok := svc.Test(TestInput{Provider: "forward", Forward: json.RawMessage(fmt.Sprintf(
		`{"request":{"url":"%s/x","method":"GET"},"response":{"type":"text"},"probe":{"url":"%s/status"}}`,
		probe.URL, probe.URL))})
	if !ok.OK || ok.LatencyMS <= 0 {
		t.Fatalf("探活应成功: %+v", ok)
	}
	bad := svc.Test(TestInput{Provider: "forward", Forward: json.RawMessage(fmt.Sprintf(
		`{"request":{"url":"%s/x","method":"GET"},"response":{"type":"text"},"probe":{"url":"%s/status","expect_status":201}}`,
		probe.URL, probe.URL))})
	if bad.OK || !strings.Contains(bad.Error, "201") {
		t.Fatalf("期望 201 应失败: %+v", bad)
	}
	nop := svc.Test(TestInput{Provider: "forward", Forward: json.RawMessage(fwdSpec)})
	if !nop.OK || nop.LatencyMS != 0 {
		t.Fatalf("无 probe 应直接 OK: %+v", nop)
	}
}
```

（imports 追加：`encoding/json`、`fmt`、`strings`——`errors`/`net/http`/`httptest` 已有。）

- [ ] **Step 8: 写 controller 层测试（追加到 `controller/config_test.go` 末尾）**

```go
func TestForwardAddViaHTTP(t *testing.T) {
	r := newConfigRouter(t)
	body := `{"provider":"forward","forward":{"request":{"url":"http://127.0.0.1:1/x","method":"GET"},"response":{"type":"text"}}}`
	w := doConfigJSON(t, r, http.MethodPost, "/config/connections", body)
	if w.Code != http.StatusOK {
		t.Fatalf("forward 保存 = %d %s", w.Code, w.Body.String())
	}
	var st service.ConfigState
	_ = json.Unmarshal(w.Body.Bytes(), &st)
	if len(st.Connections) != 1 || len(st.Connections[0].Forward) == 0 {
		t.Fatalf("forward 应落盘并回传: %+v", st)
	}
}
```

- [ ] **Step 9: 跑测试确认通过**

Run: `cd server && go test ./internal/service/ -run TestForward -count=1 && go test ./internal/controller/ -run TestForwardAddViaHTTP -count=1`
Expected: PASS

- [ ] **Step 10: 全量回归 + commit**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全绿（既有 OpenAI 兼容连接行为不变：`Forward` 为 nil 时所有分支走原路）

```bash
git add server/internal/configstore/configstore.go server/internal/service/config.go server/internal/service/config_test.go server/internal/controller/config.go server/internal/controller/config_test.go
git commit -m "feat(config): 连接配置支持转发 provider（保存/校验/探活/热切换）"
```

---

### Task 6: 前端表单

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/configApi.ts`（三类型加 forward）
- Modify: `apps/desktop/src/renderer/src/pet/settings/connectionFormat.ts`（PROVIDER_LABEL/modelLabel/hostOf）
- Modify: `apps/desktop/src/renderer/src/store/connectionStore.ts:115`（测试成功文案分支）
- Modify: `apps/desktop/src/renderer/src/pet/settings/ConnectionPage.tsx`（表单）
- Test: `apps/desktop/src/renderer/src/pet/settings/__test__/ConnectionPage.test.tsx`、`__test__/connectionFormat.test.ts`

**Interfaces:**
- Consumes: 后端 `ConnectionOut.forward`（对象，Task 5）
- Produces:
  - `ConnInput`/`TestInput`/`ConnectionInfo` 带 `forward?: unknown`
  - `modelLabel(c: ConnectionInfo): string`、`PROVIDER_LABEL.forward`
  - 表单：provider=forward 时隐藏四项输入、显示 JSON textarea（`aria-label="转发配置"`）+「填入示例」+ 行号红字

- [ ] **Step 1: configApi.ts 类型加字段**

```ts
export interface ConnectionInfo {
  id: string
  provider: string
  base_url: string
  model: string
  max_tokens: number
  key_masked: string
  has_key: boolean
  last_check: string | null
  check_fail: boolean
  active: boolean
  forward?: unknown
}
```

`ConnInput` 与 `TestInput` 各加 `forward?: unknown`。

- [ ] **Step 2: connectionFormat.ts 加映射与显示名**

`PROVIDER_LABEL` 加 `forward: '自定义（转发）'`；文件末尾加：

```ts
/** 列表显示名：转发连接无模型名，显示「转发」。 */
export function modelLabel(c: ConnectionInfo): string {
  return c.provider === 'forward' ? '转发' : c.model
}
```

`hostOf` 改为（转发连接从 `forward.request.url` 取 host，base_url 为空）：

```ts
export function hostOf(c: ConnectionInfo): string {
  if (c.provider === 'forward' && c.forward) {
    const cfg = c.forward as { request?: { url?: string } }
    try {
      return new URL(cfg.request?.url ?? '').host
    } catch {
      /* 非法配置：走下方兜底 */
    }
  }
  const raw = c.base_url || PROVIDER_DEFAULT_URL[c.provider] || ''
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
}
```

- [ ] **Step 3: connectionStore.ts 测试成功文案分支（`connectionStore.ts:115`）**

```ts
        testResult: r.ok
          ? {
              ok: true,
              message: r.latency_ms === undefined ? '配置合法（未配置探活地址）' : `连接成功 · ${r.latency_ms}ms`
            }
          : { ok: false, message: r.error ?? '连接失败' }
```

- [ ] **Step 4: ConnectionPage.tsx 表单改造**

按以下六处修改（保持单引号/无分号/无尾逗号/120 宽）：

a) import 加 `PROVIDER_LABEL`、`modelLabel`：

```ts
import { hostOf, modelLabel, PROVIDER_LABEL, providerLabel, relTime } from './connectionFormat'
```

b) `FormState` 加 `forward: string`；`EMPTY_FORM` 加 `forward: ''`；`formFromConn` 返回加：

```ts
    forward: c.forward ? JSON.stringify(c.forward, null, 2) : ''
```

c) 模块级加示例与校验助手（`buildInput` 之前）：

```ts
/** 「填入示例」模板：最小可用转发配置（无任何真实令牌，令牌用 {{env:NAME}}）。 */
const FORWARD_EXAMPLE = `{
  "version": 1,
  "request": {
    "url": "http://127.0.0.1:3100/api/chat",
    "method": "POST",
    "headers": { "content-type": "application/json" },
    "body": { "text": "{{last_user}}" }
  },
  "response": { "type": "json", "text_path": "reply" },
  "options": { "include_system": false, "include_history": false, "session_id": "pet" },
  "probe": { "url": "http://127.0.0.1:3100/api/status" }
}`

/** 转发 JSON 文本 → 错误文案（null = 合法）。空文本不算错（保存按钮另行禁用）。 */
function parseForwardErr(text: string): string | null {
  if (text.trim() === '') return null
  try {
    JSON.parse(text)
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'JSON 语法错误'
    const m = /position (\d+)/.exec(msg)
    if (m !== null) {
      const line = text.slice(0, Number(m[1])).split('\n').length
      return `JSON 语法错误（第 ${line} 行）: ${msg}`
    }
    return `JSON 语法错误: ${msg}`
  }
}
```

d) `buildInput` 返回类型与实现（spec §5.1：forward 必须发 JSON 对象，不能发字符串）：

```ts
function buildInput(f: FormState): {
  provider: string
  base_url: string
  model: string
  api_key: string
  max_tokens: number
  forward?: unknown
} {
  const n = Number.parseInt(f.maxTokens, 10)
  const forward = f.provider === 'forward' ? JSON.parse(f.forward) : undefined // 调用前 forwardErr === null 兜底
  return {
    provider: f.provider,
    base_url: f.baseUrl.trim(),
    model: f.model.trim(),
    api_key: f.apiKey,
    max_tokens: Number.isFinite(n) && n > 0 ? n : 0,
    forward
  }
}
```

e) 组件内：`canSave` 与 `onTest` 改为（`patch` 定义附近）：

```ts
  const forwardErr = parseForwardErr(form.forward)
  const canSave =
    (form.provider === 'forward' ? form.forward.trim() !== '' && forwardErr === null : form.model.trim() !== '') && !saving

  const onTest = (): void => {
    if (form.provider === 'forward' && (forwardErr !== null || form.forward.trim() === '')) return
    // 编辑模式 key 未动时 api_key 为空——带 id 让后端回退该连接的存储 key
    void test({ ...buildInput(form), id: editing?.id ?? '' })
  }
```

（删掉原 `const keyEditable …` 下面那行旧 `canSave`。）

f) 显示名三处与条件渲染：

- `meta`（`:77`）改为 `当前 ${modelLabel(active)} · …`；当前模型卡（`:163`）与连接行（`:196`）的 `{active.model}`/`{c.model}` 改为 `{modelLabel(active)}`/`{modelLabel(c)}`。
- 服务商下拉的硬编码对象改为 `Object.entries(PROVIDER_LABEL)`。
- 表单布局：第一行保留服务商，Base URL 的 `<label>` 外包 `{form.provider !== 'forward' && (…)}`；API Key 行、模型名+最大 Token 行整体包进 `{form.provider === 'forward' ? (…) : (…)}` 的 else 支；forward 支为：

```tsx
          {form.provider === 'forward' ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className={labelCls}>转发配置（JSON）</span>
                <button
                  type="button"
                  className="text-[9px] text-primary-deep cursor-pointer hover:underline"
                  onClick={() => patch({ forward: FORWARD_EXAMPLE })}
                >
                  填入示例
                </button>
              </div>
              <textarea
                className="h-[160px] w-full resize-none rounded-[9px] border border-border bg-surface px-2.5 py-2 font-mono text-[10px] text-ink outline-none placeholder:text-ink-faint focus:border-primary-soft focus:shadow-focus"
                aria-label="转发配置"
                placeholder='{"request": {"url": "http://127.0.0.1:3100/api/chat", "method": "POST"}, "response": {"type": "json", "text_path": "reply"}}'
                value={form.forward}
                onChange={(e) => patch({ forward: e.target.value })}
              />
              {forwardErr !== null && <span className="text-[10px] text-accent-ink">{forwardErr}</span>}
            </div>
          ) : (
            <>…原有 API Key 行与模型名/最大 Token 行…</>
          )}
```

- footer 改为：

```tsx
      <footer className="shrink-0 text-[10px] text-ink-footer">
        {formOpen && form.provider === 'forward'
          ? '转发配置存于本机 config.json（0600）；令牌请用 {{env:NAME}} 引用，勿写明文'
          : '密钥存于本机 keychain，不随对话上传 · 兼容 OpenAI 协议'}
      </footer>
```

- [ ] **Step 5: 写失败前端测试**

`__test__/connectionFormat.test.ts` 追加：

```ts
  it('forward 显示名 / modelLabel / hostOf 取 request.url', () => {
    expect(providerLabel('forward')).toBe('自定义（转发）')
    expect(modelLabel({ ...base, id: 'x', provider: 'forward', base_url: '', model: '' })).toBe('转发')
    expect(
      hostOf({
        ...base,
        id: 'x',
        provider: 'forward',
        base_url: '',
        model: '',
        forward: { request: { url: 'http://127.0.0.1:3100/api/chat' } }
      })
    ).toBe('127.0.0.1:3100')
  })
```

`__test__/ConnectionPage.test.tsx` 末尾追加：

```tsx
describe('转发表单', () => {
  const openForwardForm = (): void => {
    fireEvent.click(screen.getByText('添加连接'))
    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'forward' } })
  }

  it('选择自定义（转发）后隐藏四项输入，显示 JSON 框', () => {
    seed({ active_id: '', connections: [] })
    render(<ConnectionPage />)
    openForwardForm()
    expect(screen.getByLabelText('转发配置')).toBeTruthy()
    expect(screen.queryByLabelText('Base URL')).toBeNull()
    expect(screen.queryByLabelText('API Key')).toBeNull()
    expect(screen.queryByLabelText('模型名')).toBeNull()
    expect(screen.queryByLabelText('最大 Token')).toBeNull()
  })

  it('填入示例后保存：add 收到解析后的 forward 对象', () => {
    seed({ active_id: '', connections: [] })
    render(<ConnectionPage />)
    openForwardForm()
    fireEvent.click(screen.getByText('填入示例'))
    fireEvent.click(screen.getByText('保存并启用'))
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'forward',
        forward: expect.objectContaining({ version: 1, request: expect.objectContaining({ url: 'http://127.0.0.1:3100/api/chat' }) })
      })
    )
  })

  it('非法 JSON：红字带行号，保存与测试禁用', () => {
    seed({ active_id: '', connections: [] })
    render(<ConnectionPage />)
    openForwardForm()
    fireEvent.change(screen.getByLabelText('转发配置'), { target: { value: '{\n "request": {' } })
    expect(screen.getByText(/JSON 语法错误（第 2 行）/)).toBeTruthy()
    expect((screen.getByText('保存并启用').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('测试连接').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/settings/__test__/connectionFormat.test.ts src/renderer/src/pet/settings/__test__/ConnectionPage.test.tsx`
Expected: 新增用例失败（`providerLabel('forward')` 未映射 / 表单未出现）

- [ ] **Step 7: 跑测试确认通过 + 格式化检查**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/settings/__test__/connectionFormat.test.ts src/renderer/src/pet/settings/__test__/ConnectionPage.test.tsx && pnpm format:check && pnpm typecheck`
Expected: 全部通过（format:check 如有报错先 `pnpm format` 修复再提交）

- [ ] **Step 8: 全量回归 + commit**

Run: `make test`（仓库根）
Expected: Go vet/test + typecheck + vitest 全绿

```bash
git add apps/desktop/src/renderer/src/lib/configApi.ts apps/desktop/src/renderer/src/pet/settings/connectionFormat.ts apps/desktop/src/renderer/src/store/connectionStore.ts apps/desktop/src/renderer/src/pet/settings/ConnectionPage.tsx apps/desktop/src/renderer/src/pet/settings/__test__/connectionFormat.test.ts apps/desktop/src/renderer/src/pet/settings/__test__/ConnectionPage.test.tsx
git commit -m "feat(settings): 连接表单支持转发 provider（JSON 配置/示例/行号校验）"
```

---

### Task 7: 手工验收 + 文档状态更新

**Files:**
- Modify: `docs/forward-provider.md`（状态行）、`docs/design.md`（§4 唯一实现表述）
- 验收对象：真实运行的 app（`make dev`，先 `memory_pressure -Q` 查内存）

**Interfaces:**
- Consumes: Task 1-6 全部
- Produces: 可发布的「转发 Provider」能力；spec 状态转「已实施」

- [ ] **Step 1: 起本地 mock 后端（另开终端）**

```bash
node -e '
const http = require("http")
http.createServer((req, res) => {
  let b = ""
  req.on("data", (d) => (b += d))
  req.on("end", () => {
    console.log("REQ", req.url, b)
    if (req.url === "/api/status") { res.end("ok"); return }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ reply: "你好，我是转发后端" }))
  })
}).listen(3100, "127.0.0.1")
'
```

- [ ] **Step 2: 启动应用**：仓库根 `make dev`（**先跑 `memory_pressure -Q`**，内存吃紧会 SIGTERM 整个 make dev）

- [ ] **Step 3: 按 spec §7.3 逐项验收**

| # | 操作 | 期望 |
|---|---|---|
| 1 | 设置·模型与连接 → 添加连接 → 服务商选「自定义（转发）」→ 填入示例 → 保存并启用 → 桌宠窗聊一句 | 气泡回复「你好，我是转发后端」，打字机效果正常；mock 终端打印请求体 |
| 2 | 回复过程中点「停止」 | 100ms 内停 |
| 3 | 编辑连接，把 `text_path` 改成 `nope` → 保存 → 聊天 | 报「路径 … 未命中」，不是静默空回复 |
| 4 | 配置 `"include_system": false` → 聊天 | mock 终端打印的请求体里 `{{system}}` 为空、`messages` 无 system 条目 |
| 5 | 把 probe url 改成 `http://127.0.0.1:3199/status` → 测试连接 | 失败，文案含「探活失败」；改回后测试成功显示「连接成功 · Nms」 |
| 6 | 重启应用（含 Go server） | 连接仍在列表、仍是激活连接 |
| 7 | 不配 probe（删掉 probe 块）→ 测试连接 | 显示「配置合法（未配置探活地址）」 |

视觉项（1 的打字机、表单外观）**需用户亲眼确认**——确认通过后才执行 Step 4 的文档提交（仓库约定：需视觉验证的改动不得由 Claude 直接 commit）。

- [ ] **Step 4: 文档状态更新 + commit（用户确认验收通过后）**

`docs/forward-provider.md` 第 3 行：

```markdown
> 状态：已实施（2026-10-25，计划见 docs/superpowers/plans/2026-10-25-forward-provider.md）
```

`docs/design.md` §4（`:111`）「**Provider 抽象**」句末追加：

```markdown
；新增 `forward`（声明式 HTTP 转发，docs/forward-provider.md）——接任意本地 AI 应用零代码适配
```

```bash
git add docs/forward-provider.md docs/design.md
git commit -m "docs(forward): 转发 provider 实施完成，更新状态与设计文档"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3 数据模型→T1/T5；§4.1-4.3→T4；§4.4 三处分支→T5；§4.5→T2（Message json tag 补齐 `{{messages}}` 序列化形状）；§4.6→T3；§4.7→T4；§4.8→T4；§4.9→T5；§5.1 前端细节（对象非字符串/行号/示例/隐藏四输入）→T6；§5.2 ConnectionOut 回传→T5；§6 兼容性（老配置 nil、空配置拒绝、坏 JSON 行号、fallback 不变）→T1/T5 测试覆盖；§7.3 手工验收→T7；§9 不重试（代码中无重试逻辑）✓。
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整实现。
- **类型一致性**：`placeholderCtx`/`renderBody`/`renderString`/`ExtractPath`/`UsesPlaceholder`/`ParseForwardSpec`/`NewForward` 签名在 Task 1-4 定义与 Task 5-6 使用处一致；`split` 在 Task 4 Step 3 给了最终简化版（以最后一段为准）；`Forward` 字段 Go 侧 `json.RawMessage`、TS 侧 `unknown`，HTTP 上为 JSON 对象（前端 `JSON.parse` 后提交，绝不以字符串发送）。

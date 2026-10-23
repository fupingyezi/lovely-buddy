# M2 流式聊天 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通桌宠与 LLM 的流式对话全链路：SSE 流式回复、打字机气泡、`[motion:]` 标签触发动作并剥离入库、历史持久化、停止生成、断线恢复。

**Architecture:** 后端先做一次分层解耦——`internal/controller`（接口处理：参数解析/校验/状态码/SSE 写出）、`internal/router`（路由装配）、`server.go` 只做组装（engine + 中间件 + Register）；随后新增 `internal/config`（.env + 对话配置）、`internal/llm`（ChatProvider 抽象 + OpenAI 兼容唯一实现）、`internal/dao`（sessions/messages 的 SQL）、`internal/service`（MotionFilter 流式标签剥离、prompt 组装、ChatStore 接口 + MemStore、ChatService 流式编排）。依赖方向单向：dao ← service ← controller ← router ← server。渲染进程新增 `lib/chatApi.ts`（SSE 客户端）、`store/chatStore.ts`、聊天面板（窗口向上扩展区：历史+输入框）与打字机气泡。窗口扩展机制从单层改为**按键位记账**（`menu`/`chat` 共存叠加），气泡/面板共用 `chat` 扩展位。

**Tech Stack:** Go（新增依赖仅 `sashabaranov/go-openai`）+ gin SSE + pgx；React 18 + zustand + vitest。

**Spec:** `docs/design.md` §4（模型对接）、§7 M2 行（验收：流式不卡顿；库里 content 干净；重启历史完整）

## 关键决策（design.md 未细化处的裁定）

1. **单会话模型**：M2 只有一个默认会话（最新一条，无则建，title `AI桌宠对话`）。依据 §4「改人设 = 显式弃用该会话缓存前缀」——persona 变化只影响 system prompt，不分裂会话；M5 记忆也要求跨形象统一。`000001_init` 已有 sessions/messages 表（含 motion 列），**无需新迁移**（M5 仍用 000002）。
2. **配置来源 = env + `.env`**：M3 设置面板（/api/config）之前的过渡方案。Go 进程自己加载 `../.env`（不覆盖已存在的环境变量），与 `make dev` 现有编排零冲突；`.env.example` 已声明 DEEPSEEK_API_KEY。
3. **每请求携带 avatar slug**：后端无当前形象状态，`POST /chat` body 带 `avatar`（可选），服务端经 `assets.PersonaText` 读该形象 persona 注入 system prompt（§4 每形象人格）。
4. **停止 = AbortController 断开连接**：客户端 abort fetch → 服务端 `c.Request.Context()` 取消 → provider 流关闭 → **已生成的半截内容照常落库**后正常收尾（不发 error）。
5. **motion 剥离只在服务端做一次**（流式安全），入库 content 即干净文本；渲染端 `parseMotionTags` 保留不动（M1 预埋，本期不复用）。
6. **聊天 UI 形态**：菜单「聊天」入口 → 窗口向上扩 240px 的聊天面板（最近对话 + 输入框）；流式期间即使面板关闭也保持扩展，回复以打字机气泡悬在扩展区顶部，8s 无更新淡出。
7. **后端分层（用户要求，先于 M2 新代码执行）**：dao（数据库操作）/ service（业务逻辑）/ controller（接口处理）/ router（路由装配）分离，`server.go` 只负责组装。`internal/assets` 保持原样——它本身就是形象域的 service（纯文件系统操作，无 DB，不拆 dao）；其 HTTP 处理从 server.go 拆入 controller。持久化消息类型 `Message` 放 dao（底层），service/controller 复用，避免 dao→service 反向依赖。

## Global Constraints

- Go module `lovelybuddy/server`；本轮**唯一新增 Go 依赖** `github.com/sashabaranov/go-openai`（spec §4 选型）
- env 命名 `LOVELYBUDDY_*`；API 只绑 127.0.0.1，`/api/v1/*` 全部 `Authorization: Bearer` 鉴权
- motion 意图集合固定 11 个，与 renderer `live2d/motionMap.ts` 的 `MotionIntent` 一致：idle/tap/greet/thinking/speak/happy/sad/angry/surprised/bye/sleep
- **入库 content 必须是剥离 `[motion:]` 标签后的干净文本**；motion 列存最后识别的意图
- 测试：Go 测试与源码同目录 `*_test.go`（不用 `__test__/`，Go 忽略 `_` 目录）；前端测试放功能目录 `__test__/`
- 涉及真实 DB 的测试：只动测试自建的 session 行，**不得清理/影响 dev 库既有数据**；DB 不可达时 `t.Skip`（`make db` 起库后自动纳入）
- UI 文案中文、产品显示名 **AI桌宠**（禁角色名）；console 前缀 `[lovely-buddy]`（renderer）/ slog 模块前缀（Go）
- Commit：Conventional Commits、subject 小写开头，直接提交 main
- **后端分层约束**：新代码按 `dao`（SQL）/ `service`（业务）/ `controller`（接口）/ `router`（装配）落位；`server.go` 只组装，不出现路由注册与业务调用；依赖单向 dao ← service ← controller ← router ← server，禁止反向 import
- 不改 `make dev` 编排、`l2d://` 协议、CORS/token 中间件行为

## 文件结构总览

```
server/internal/controller/        healthz.go assets.go（Task 1 从 server.go 拆出）
                                   chat.go（Task 9：SSE/history 接口）
server/internal/router/            router.go                           路由装配（Task 1 建，Task 9 扩 chat）
server/internal/server/            server.go                           只组装（Task 1 瘦身）
server/internal/config/            config.go + config_test.go          .env 加载 + Chat 配置
server/internal/llm/               provider.go + openai_compat.go(+test)  接口/注册表/实现
server/internal/dao/               chat.go(+test)                      Message 类型 + ChatDAO（SQL）
server/internal/service/           motionfilter.go(+test)              流式标签剥离
                                   prompt.go(+test)                    人设+动作协议 prompt
                                   memstore.go(+test)                  ChatStore 接口 + 内存实现
                                   chat.go(+test)                      ChatService 流式编排
server/internal/assets/            persona.go + persona_test.go        PersonaText（域包即 service，不动）
server/cmd/lovely-buddy-server/    main.go                             接线
apps/desktop .../main/window/      manager.ts ipc.ts                   expandFor/collapseFor
apps/desktop .../preload/index.ts  env.d.ts                            expandWindow(key,...)
apps/desktop .../renderer/src/lib/ chatApi.ts(+__test__)               SSE 客户端
apps/desktop .../renderer/src/store/ chatStore.ts(+__test__)           发送/停止/刷新
apps/desktop .../renderer/src/live2d/ modelBus.ts                      模型实例总线
apps/desktop .../renderer/src/pet/chat/ useChatPanel.ts ChatPanel.tsx SpeechBubble.tsx
                                       useTypewriter.ts + __test__/    聊天面板与气泡
apps/desktop .../renderer/src/pet/ PetMenu.tsx PetCanvas.tsx App.tsx   入口/集成
```

---

### Task 1: server 解耦 —— controller / router 拆分（server.go 只组装）

**Files:**
- Create: `server/internal/controller/healthz.go`（含 Version 常量）
- Create: `server/internal/controller/assets.go`
- Create: `server/internal/router/router.go`
- Modify: `server/internal/server/server.go`（瘦身为纯组装）
- Modify: `server/internal/server/server_test.go`（新增 ping 表征测试）
- Modify: `server/cmd/lovely-buddy-server/main.go`（Version 引用改 controller）

**Interfaces:**
- Consumes: 现有 `middleware.AccessLog/CORS/Token`、`assets.Detect/Import/Delete`（行为全部不变，纯搬家）
- Produces: `controller.Version`（自 server 包迁入）；`controller.NewHealthz(pool *pgxpool.Pool) gin.HandlerFunc`；`controller.NewAssets(modelDir string) *Assets`（`List/Import/Delete` gin handlers）；`router.Register(r *gin.Engine, pool *pgxpool.Pool, token, modelDir string)`；`server.New(addr, token string, pool *pgxpool.Pool, modelDir string)` 签名不变。Task 9 在此基础上扩展 Register（增 chats 参数）。

这是表征测试护航的纯重构：先补一条测试锁住现有行为基线，再搬代码，全部既有测试保持绿。

- [ ] **Step 1: 写表征测试（现有行为，应当直接通过）**

在 `server/internal/server/server_test.go` 追加：

```go
func TestPing(t *testing.T) {
	ts, _ := newTestServer(t)
	resp, m := doJSON(t, http.MethodGet, ts.URL+"/api/v1/ping", testToken, nil)
	if resp.StatusCode != http.StatusOK || m["pong"] != true {
		t.Fatalf("ping 应 200 pong: %d %v", resp.StatusCode, m)
	}
}
```

- [ ] **Step 2: 跑测试确认通过（重构基线为绿）**

Run: `cd server && go test ./internal/server/`
Expected: PASS（新增 TestPing 与既有测试全绿）

- [ ] **Step 3: 拆 controller（healthz + assets，行为原样搬移）**

Create `server/internal/controller/healthz.go`：

```go
// Package controller HTTP 接口层：只做参数解析/校验/状态码/响应写出。
// 业务逻辑在 internal/service 与域包（assets），数据访问在 internal/dao。
package controller

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Version 供 /healthz 与托盘状态展示（自 server 包迁入，避免 controller→server 反向依赖）。
const Version = "0.1.0-dev"

// NewHealthz /healthz：健康探测（公开路由，wait-on 与状态展示用，不含敏感信息）。
// pool 为 nil（如测试）时 db 报 error——原实现会 nil panic，这里顺手兜住（行为微修，可接受）。
func NewHealthz(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		dbStatus := "error"
		if pool != nil {
			pingCtx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
			defer cancel()
			if err := pool.Ping(pingCtx); err == nil {
				dbStatus = "ok"
			}
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "db": dbStatus, "version": Version})
	}
}
```

Create `server/internal/controller/assets.go`：

```go
package controller

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/assets"
)

// Assets 形象库接口（业务在 internal/assets 域包，本层只做 HTTP 胶水）。
type Assets struct{ modelDir string }

func NewAssets(modelDir string) *Assets { return &Assets{modelDir: modelDir} }

// List GET /api/v1/assets → {avatars}
func (a *Assets) List(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"avatars": assets.Detect(a.modelDir)})
}

// Import POST /api/v1/assets/import body {source} → {avatar}（失败 422 {error}）
func (a *Assets) Import(c *gin.Context) {
	var req struct {
		Source assets.ImportSource `json:"source"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	av, err := assets.Import(a.modelDir, req.Source)
	if err != nil {
		slog.Error("assets: 导入失败", "source", req.Source.Type, "err", err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"avatar": av})
}

// Delete DELETE /api/v1/assets/:slug → {ok:true}（非法 slug 400）
func (a *Assets) Delete(c *gin.Context) {
	if err := assets.Delete(a.modelDir, c.Param("slug")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
```

- [ ] **Step 4: 建 router（路由表全在此：路径 → controller）**

Create `server/internal/router/router.go`：

```go
// Package router 路由装配：只声明「路径 → controller」与鉴权分组，不写业务。
// /healthz 公开；/api/v1 全部 token 鉴权。
package router

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"lovelybuddy/server/internal/controller"
	"lovelybuddy/server/internal/middleware"
)

// Register 注册全部路由（在 engine 挂完全局中间件之后调用）。
func Register(r *gin.Engine, pool *pgxpool.Pool, token, modelDir string) {
	r.GET("/healthz", controller.NewHealthz(pool))

	api := r.Group("/api/v1", middleware.Token(token))
	assetsCtl := controller.NewAssets(modelDir)
	api.GET("/ping", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"pong": true}) })
	api.GET("/assets", assetsCtl.List)
	api.POST("/assets/import", assetsCtl.Import)
	api.DELETE("/assets/:slug", assetsCtl.Delete)
}
```

- [ ] **Step 5: server.go 瘦身为组装 + main.go 改 Version 引用**

`server/internal/server/server.go` 全文替换为：

```go
// server 包只做组装：engine + 全局中间件 + 路由注册。
// 具体路由在 internal/router，接口处理在 internal/controller，
// 业务在 internal/service 与域包（assets），数据访问在 internal/dao。
package server

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"lovelybuddy/server/internal/middleware"
	"lovelybuddy/server/internal/router"
)

// New 组装 HTTP 服务。pool 可为 nil（healthz 将报 db error）。
func New(addr, token string, pool *pgxpool.Pool, modelDir string) *http.Server {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(middleware.AccessLog(), gin.Recovery(), middleware.CORS())
	router.Register(r, pool, token, modelDir)
	return &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
}
```

`server/cmd/lovely-buddy-server/main.go`：import 增 `"lovelybuddy/server/internal/controller"`，第 56 行 `"version", server.Version` 改为 `"version", controller.Version`（`server.New` 仍用 server 包，import 保留）。

- [ ] **Step 6: 全量测试 + vet（重构后必须仍绿）**

Run: `cd server && go vet ./... && go test ./...`
Expected: PASS（所有包，含既有 assets/server 测试——行为零变化）

- [ ] **Step 7: Commit**

```bash
git add server/internal/controller/ server/internal/router/ server/internal/server/ server/cmd/
git commit -m "refactor(server): 拆分 controller/router，server 只负责组装"
```

---

### Task 2: Go config 包 —— .env 加载 + 对话配置

**Files:**
- Create: `server/internal/config/config.go`
- Create: `server/internal/config/config_test.go`

**Interfaces:**
- Consumes: 无
- Produces: `config.Load() Config`；`Config{Chat Chat}`；`Chat{Provider, Model, BaseURL string}`；`LoadEnvFile(path string) error`（文件不存在返回 nil；已存在的环境变量不覆盖）。Task 9 的 main.go 接线消费。

- [ ] **Step 1: 写失败测试**

Create `server/internal/config/config_test.go`：

```go
package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, ".env")
	if err := os.WriteFile(p, []byte(`
# 注释行
DEEPSEEK_API_KEY=sk-test
QUOTED="带引号"
EXISTING=override-me

BROKEN_LINE_NO_EQ
`), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EXISTING", "keep") // 已存在的环境变量优先，不被 .env 覆盖

	if err := LoadEnvFile(p); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("DEEPSEEK_API_KEY"); got != "sk-test" {
		t.Fatalf("DEEPSEEK_API_KEY=%q", got)
	}
	if got := os.Getenv("QUOTED"); got != "带引号" {
		t.Fatalf("QUOTED=%q（应剥成对引号）", got)
	}
	if got := os.Getenv("EXISTING"); got != "keep" {
		t.Fatalf("EXISTING=%q（已存在不应被覆盖）", got)
	}
}

func TestLoadEnvFileMissingIsNoop(t *testing.T) {
	if err := LoadEnvFile(filepath.Join(t.TempDir(), "nope.env")); err != nil {
		t.Fatalf("文件不存在应返回 nil, got %v", err)
	}
}

func TestLoadReadsChatConfig(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, ".env")
	if err := os.WriteFile(p, []byte("LOVELYBUDDY_CHAT_PROVIDER=dashscope\nLOVELYBUDDY_CHAT_MODEL=qwen-turbo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOVELYBUDDY_ENV_FILE", p) // Load 的 env 文件路径可注入，测试不依赖工作目录
	if got := Load().Chat.Provider; got != "dashscope" {
		t.Fatalf("provider=%q", got)
	}
	if got := Load().Chat.Model; got != "qwen-turbo" {
		t.Fatalf("model=%q", got)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/config/`
Expected: FAIL（`undefined: LoadEnvFile` 等）

- [ ] **Step 3: 写实现**

Create `server/internal/config/config.go`：

```go
// Package config 读取运行配置。M2 从环境变量 + .env 文件读取（.env 不覆盖已有环境变量）；
// M3 设置面板接管厂商/key 的读写后，这里仍是 env 侧的默认来源。
package config

import (
	"bufio"
	"os"
	"strings"
)

// Chat 对话模型配置。
type Chat struct {
	Provider string // deepseek | dashscope；空 = deepseek（llm.Resolve 兜底）
	Model    string // 空 = 用厂商默认模型
	BaseURL  string // 空 = 用厂商默认地址；非空覆盖（任意 OpenAI 兼容端点）
}

type Config struct {
	Chat Chat
}

// LoadEnvFile 逐行加载 KEY=VALUE（# 注释、空行、无 = 行忽略；value 剥成对引号）。
// 已存在的环境变量不覆盖（真实 env 优先）。文件不存在返回 nil（未建 .env 合法）。
func LoadEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' && v[len(v)-1] == '"' || v[0] == '\'' && v[len(v)-1] == '\'') {
			v = v[1 : len(v)-1]
		}
		if k != "" && os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
	return sc.Err()
}

// envFile 查找顺序：LOVELYBUDDY_ENV_FILE → ../.env（air 在 server/ 下运行 = 仓库根）→ ./.env。
func envFile() string {
	if p := os.Getenv("LOVELYBUDDY_ENV_FILE"); p != "" {
		return p
	}
	if _, err := os.Stat("../.env"); err == nil {
		return "../.env"
	}
	return ".env"
}

// Load 加载 .env 后解析全部配置。
func Load() Config {
	_ = LoadEnvFile(envFile())
	return Config{
		Chat: Chat{
			Provider: os.Getenv("LOVELYBUDDY_CHAT_PROVIDER"),
			Model:    os.Getenv("LOVELYBUDDY_CHAT_MODEL"),
			BaseURL:  os.Getenv("LOVELYBUDDY_CHAT_BASE_URL"),
		},
	}
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/config/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/config/
git commit -m "feat(server): config 包加载 .env 与对话配置"
```

---

### Task 3: Go llm 包 —— ChatProvider 抽象 + OpenAI 兼容实现

**Files:**
- Create: `server/internal/llm/provider.go`（接口 + Providers 注册表 + Resolve）
- Create: `server/internal/llm/openai_compat.go`（实现）
- Create: `server/internal/llm/openai_compat_test.go`
- Modify: `server/go.mod` / `server/go.sum`（go get 自动）

**Interfaces:**
- Consumes: 无
- Produces: `llm.Message{Role, Content string}`；`llm.StreamEvent{Delta string; Err error}`；`llm.ChatProvider` 接口（`StreamChat(ctx, msgs []Message) <-chan StreamEvent` / `Configured() bool` / `KeyEnv() string`）；`llm.Providers` 注册表；`llm.Resolve(provider, model, baseURLOverride string) (*OpenAICompat, error)`。Task 8 的 ChatService 消费接口；Task 9 的 main.go 消费 Resolve。

- [ ] **Step 1: 加依赖**

```bash
cd server && go get github.com/sashabaranov/go-openai@latest
```

- [ ] **Step 2: 写失败测试**

Create `server/internal/llm/openai_compat_test.go`：

```go
package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// fakeUpstream 模拟 OpenAI 兼容 SSE 端点：校验鉴权头后按 script 逐段吐 delta。
func fakeUpstream(t *testing.T, chunks []string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		for _, c := range chunks {
			_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":" + quote(c) + "}}]}\n\n"))
			fl.Flush()
		}
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
		fl.Flush()
	}))
	t.Cleanup(srv.Close)
	return srv
}

func quote(s string) string {
	// 测试 chunk 不含引号/转义，直接拼 JSON 字符串
	return "\"" + s + "\""
}

func TestResolveUnknownProvider(t *testing.T) {
	if _, err := Resolve("nope", "", ""); err == nil {
		t.Fatal("未知厂商应报错")
	}
}

func TestResolveDefaults(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "test-key")
	p, err := Resolve("", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !p.Configured() || p.KeyEnv() != "DEEPSEEK_API_KEY" {
		t.Fatalf("Configured=%v KeyEnv=%s", p.Configured(), p.KeyEnv())
	}
}

func TestStreamChatDeltas(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "test-key")
	up := fakeUpstream(t, []string{"你", "好", "呀"})
	p, err := Resolve("deepseek", "", up.URL) // BaseURL 覆盖指向假上游
	if err != nil {
		t.Fatal(err)
	}

	var got []string
	for ev := range p.StreamChat(context.Background(), []Message{{Role: "user", Content: "hi"}}) {
		if ev.Err != nil {
			t.Fatalf("unexpected err: %v", ev.Err)
		}
		got = append(got, ev.Delta)
	}
	if len(got) != 3 || got[0] != "你" || got[2] != "呀" {
		t.Fatalf("deltas=%v", got)
	}
}

func TestStreamChatCtxCancelClosesChannel(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "test-key")
	block := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"一\"}}]}\n\n"))
		fl.Flush()
		<-block // 挂住第二段，等客户端取消
	}))
	t.Cleanup(func() { close(block); srv.Close() })

	p, err := Resolve("deepseek", "", srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	ch := p.StreamChat(ctx, []Message{{Role: "user", Content: "hi"}})
	if (<-ch).Delta != "一" {
		t.Fatal("第一段应到达")
	}
	cancel()
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatal("取消后通道应直接关闭，不应再有事件")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("取消后 2s 内通道应关闭")
	}
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd server && go test ./internal/llm/`
Expected: FAIL（`undefined: Resolve` 等）

- [ ] **Step 4: 写实现**

Create `server/internal/llm/provider.go`：

```go
// Package llm 模型厂商抽象（spec §4）。M2 只有对话；EmbeddingProvider 留给 M5。
package llm

import "context"

// Message 一条对话消息（Role: system | user | assistant）。
type Message struct {
	Role    string
	Content string
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

// Providers 内置厂商（spec §4：默认对话 deepseek）。
var Providers = map[string]ProviderSpec{
	"deepseek":  {BaseURL: "https://api.deepseek.com", DefaultModel: "deepseek-chat", APIKeyEnv: "DEEPSEEK_API_KEY"},
	"dashscope": {BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", DefaultModel: "qwen-plus", APIKeyEnv: "DASHSCOPE_API_KEY"},
}
```

Create `server/internal/llm/openai_compat.go`：

```go
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && go test ./internal/llm/`
Expected: PASS（4 个测试全绿）

- [ ] **Step 6: Commit**

```bash
git add server/internal/llm/ server/go.mod server/go.sum
git commit -m "feat(server): llm 包 OpenAI 兼容流式 provider"
```

---

### Task 4: Go dao 包 —— Message 类型 + ChatDAO（sessions/messages SQL）

**Files:**
- Create: `server/internal/dao/chat.go`
- Create: `server/internal/dao/chat_test.go`

**Interfaces:**
- Consumes: 无（表结构 `migrations/000001_init.up.sql` 已存在，无新迁移）
- Produces: `dao.Message{Role, Content, Motion string, CreatedAt time.Time}`（JSON tag：`role`/`content`/`motion,omitempty`/`created_at`）；`dao.NewChat(pool *pgxpool.Pool) *ChatDAO`；方法集 `DefaultSession(ctx) (string, error)` / `Append(ctx, sessionID, role, content, motion string) error` / `History(ctx, sessionID string, limit int) ([]Message, error)`——与 Task 7 的 `service.ChatStore` 接口签名完全一致，`*ChatDAO` 直接满足该接口。Task 6/7/8 消费 `dao.Message`，Task 9 的 main.go 消费 NewChat。

- [ ] **Step 1: 写失败测试（连真实 DB，未起库则跳过）**

Create `server/internal/dao/chat_test.go`：

```go
package dao

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"lovelybuddy/server/internal/db"
)

// testPool 连 dev 库（make db）；不可达则跳过——避免强制依赖 DB 的单测。
// 只动本测试自建的 session 行，结束按 id 清理（messages 级联），不碰 dev 既有数据。
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("LOVELYBUDDY_DB_DSN")
	if dsn == "" {
		dsn = "postgres://lovelybuddy:lovelybuddy@127.0.0.1:5433/lovelybuddy?sslmode=disable"
	}
	pool, err := db.Connect(context.Background(), dsn)
	if err != nil {
		t.Skip("需要 pgvector（make db）:", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestChatDAOAppendHistory(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	d := NewChat(pool)

	// 自建会话行（不走 DefaultSession——它会复用 dev 库既有会话）
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO sessions (title) VALUES ('dao-test') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, id)
	})

	if err := d.Append(ctx, id, "user", "你好", ""); err != nil {
		t.Fatal(err)
	}
	if err := d.Append(ctx, id, "assistant", "你好呀", "happy"); err != nil {
		t.Fatal(err) // Append 不做剥离（service 负责），这里只验存储
	}
	msgs, err := d.History(ctx, id, 10)
	if err != nil || len(msgs) != 2 {
		t.Fatalf("len=%d err=%v", len(msgs), err)
	}
	if msgs[0].Role != "user" || msgs[1].Motion != "happy" {
		t.Fatalf("字段不符: %+v", msgs)
	}
	limited, _ := d.History(ctx, id, 1)
	if len(limited) != 1 || limited[0].Content != "你好呀" {
		t.Fatalf("limit 取最近一条升序: %+v", limited)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/dao/`
Expected: FAIL（`undefined: NewChat`——编译错误，与 DB 是否可达无关）

- [ ] **Step 3: 写实现**

Create `server/internal/dao/chat.go`：

```go
// Package dao 数据访问层：只写 SQL 与行映射，不含业务规则，
// 不 import gin / service / controller（依赖最底层）。
package dao

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Message 一条已落库消息（Content 为剥离 [motion:] 标签后的干净文本，剥离在 service 做）。
// JSON tag 即 /api/v1/history 的 messages 元素线上格式。
type Message struct {
	Role      string    `json:"role"` // user | assistant
	Content   string    `json:"content"`
	Motion    string    `json:"motion,omitempty"` // assistant 最后识别的意图，可空
	CreatedAt time.Time `json:"created_at"`
}

// ChatDAO 会话与消息的 Postgres 实现（表结构见 migrations/000001_init.up.sql）。
// 方法集与 service.ChatStore 一致，直接满足该接口。
type ChatDAO struct{ pool *pgxpool.Pool }

func NewChat(pool *pgxpool.Pool) *ChatDAO { return &ChatDAO{pool: pool} }

// DefaultSession 取最新会话，没有则创建（M2 单会话模型，title 固定）。
func (d *ChatDAO) DefaultSession(ctx context.Context) (string, error) {
	var id string
	err := d.pool.QueryRow(ctx, `SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1`).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := d.pool.QueryRow(ctx,
			`INSERT INTO sessions (title) VALUES ('AI桌宠对话') RETURNING id`).Scan(&id); err != nil {
			return "", err
		}
		return id, nil
	}
	if err != nil {
		return "", err
	}
	return id, nil
}

// Append 写一条消息（motion 空串落 NULL）。
func (d *ChatDAO) Append(ctx context.Context, sessionID, role, content, motion string) error {
	_, err := d.pool.Exec(ctx,
		`INSERT INTO messages (session_id, role, content, motion) VALUES ($1, $2, $3, NULLIF($4, ''))`,
		sessionID, role, content, motion)
	return err
}

// History 最近 limit 条，按时间（id）升序返回。
func (d *ChatDAO) History(ctx context.Context, sessionID string, limit int) ([]Message, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT role, content, COALESCE(motion, ''), created_at FROM (
			SELECT * FROM messages WHERE session_id = $1 ORDER BY id DESC LIMIT $2
		) t ORDER BY id ASC`, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.Role, &m.Content, &m.Motion, &m.CreatedAt); err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `make db && cd server && go test ./internal/dao/`
Expected: PASS（未起 DB 时显示 SKIP，`make db` 后全绿）

- [ ] **Step 5: Commit**

```bash
git add server/internal/dao/
git commit -m "feat(server): dao 层会话/消息数据访问"
```

---

### Task 5: Go service 包 —— MotionFilter 流式标签剥离

**Files:**
- Create: `server/internal/service/motionfilter.go`
- Create: `server/internal/service/motionfilter_test.go`

**Interfaces:**
- Consumes: 无
- Produces: `service.NewMotionFilter() *MotionFilter`；`(*MotionFilter) Push(chunk string) (visible, motion string)`；`(*MotionFilter) Flush() (visible, motion string)`。Task 8 的 ChatService 消费。

- [ ] **Step 1: 写失败测试**

Create `server/internal/service/motionfilter_test.go`：

```go
package service

import "testing"

func pushAll(t *testing.T, chunks ...string) (string, string) {
	t.Helper()
	f := NewMotionFilter()
	var visible, motion string
	for _, c := range chunks {
		v, m := f.Push(c)
		visible += v
		if m != "" {
			motion = m
		}
	}
	v, m := f.Flush()
	visible += v
	if m != "" {
		motion = m
	}
	return visible, motion
}

func TestMotionFilterWholeTag(t *testing.T) {
	v, m := pushAll(t, "你好[motion:happy]呀")
	if v != "你好呀" || m != "happy" {
		t.Fatalf("visible=%q motion=%q", v, m)
	}
}

func TestMotionFilterTagSplitAcrossChunks(t *testing.T) {
	// 标签被 chunk 边界劈成三段
	v, m := pushAll(t, "看这[motion:hap", "py", "]!")
	if v != "看这!" || m != "happy" {
		t.Fatalf("visible=%q motion=%q", v, m)
	}
}

func TestMotionFilterLastIntentWins(t *testing.T) {
	_, m := pushAll(t, "[motion:sad]先难过[motion:happy]后开心")
	if m != "happy" {
		t.Fatalf("motion=%q（应取最后）", m)
	}
}

func TestMotionFilterInvalidIntentStrippedButNoMotion(t *testing.T) {
	v, m := pushAll(t, "a[motion:zzz]b")
	if v != "ab" || m != "" {
		t.Fatalf("visible=%q motion=%q（非法意图剥离但不计动作）", v, m)
	}
}

func TestMotionFilterPlainBracketsPassThrough(t *testing.T) {
	v, m := pushAll(t, "数组[0]和下标a[1]b")
	if v != "数组[0]和下标a[1]b" || m != "" {
		t.Fatalf("visible=%q motion=%q", v, m)
	}
}

func TestMotionFilterUnterminatedTagFlowsBack(t *testing.T) {
	// 流结束仍不闭合 → 不是标签，按原文吐回
	v, m := pushAll(t, "结尾[motion:hap")
	if v != "结尾[motion:hap" || m != "" {
		t.Fatalf("visible=%q motion=%q", v, m)
	}
}

func TestMotionFilterIncrementalVisible(t *testing.T) {
	// Push 每次只应返回「确认安全」的增量（pending 部分不吐）；
	// 意图在标签完成的那次 Push 即返回（流式动作要尽早触发）
	f := NewMotionFilter()
	v1, m1 := f.Push("abc[mot")
	if v1 != "abc" || m1 != "" {
		t.Fatalf("v1=%q m1=%q（半截标签前缀应扣住，意图未定）", v1, m1)
	}
	v2, m2 := f.Push("ion:tap]")
	if v2 != "" || m2 != "tap" {
		t.Fatalf("v2=%q m2=%q（整段被标签吃掉，意图在完成时返回）", v2, m2)
	}
	v3, _ := f.Push("尾巴")
	if v3 != "尾巴" {
		t.Fatalf("v3=%q", v3)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/`
Expected: FAIL（`undefined: NewMotionFilter`）

- [ ] **Step 3: 写实现**

Create `server/internal/service/motionfilter.go`：

```go
// Package service 业务逻辑层：motion 标签过滤、prompt 组装、会话存储抽象与聊天编排。
// 依赖方向：dao ← service（本包）← controller；不 import gin。
package service

import (
	"regexp"
	"strings"
)

// 与 renderer live2d/motionMap.ts 的 MotionIntent 一一对应（11 个）。
var validIntents = map[string]bool{
	"idle": true, "tap": true, "greet": true, "thinking": true, "speak": true,
	"happy": true, "sad": true, "angry": true, "surprised": true, "bye": true, "sleep": true,
}

var motionTagRe = regexp.MustCompile(`\[motion:([a-zA-Z_]+)\]`)

const tagPrefix = "[motion:"

// maxHold 半截标签缓冲上限：超过则按普通文本吐回（防超长缓冲驻留）。
const maxHold = 48

// MotionFilter 流式剥离 [motion:intent] 标签：标签可能被 chunk 边界劈开，
// 可能构成标签前缀的尾巴留在 pending；Flush 把残留按原文吐回（不闭合的不是标签）。
// 行为与 renderer parseMotionTags 对齐：形似标签一律剥离；intent 合法才计为动作。
type MotionFilter struct {
	pending string
}

func NewMotionFilter() *MotionFilter { return &MotionFilter{} }

// Push 喂入增量。visible = 可安全展示的净化增量；motion = 本次新识别的意图
//（无则空串；一次 Push 含多个标签时取最后一个生效）。
func (f *MotionFilter) Push(chunk string) (visible, motion string) {
	f.pending += chunk
	return f.drain(false)
}

// Flush 流结束时调用：未闭合的残留按原文返回（它不是标签）。
func (f *MotionFilter) Flush() (visible, motion string) {
	v, m := f.drain(true)
	v += f.pending
	f.pending = ""
	return v, m
}

func (f *MotionFilter) drain(final bool) (visible, motion string) {
	for {
		if loc := motionTagRe.FindStringSubmatchIndex(f.pending); loc != nil {
			visible += f.pending[:loc[0]]
			if name := strings.ToLower(f.pending[loc[2]:loc[3]]); validIntents[name] {
				motion = name
			}
			f.pending = f.pending[loc[1]:]
			continue
		}
		// 默认全部安全吐出；仅当尾巴是半截标签时扣住
		hold := len(f.pending)
		if !final {
			// 最后一个 '[' 起的尾巴若仍可能长成标签，扣住等下一段 chunk
			if idx := strings.LastIndexByte(f.pending, '['); idx >= 0 {
				tail := f.pending[idx:]
				if len(tail) <= maxHold && maybePartialTag(tail) {
					hold = idx
				}
			}
		}
		visible += f.pending[:hold]
		f.pending = f.pending[hold:]
		return visible, motion
	}
}

// maybePartialTag tail 是否可能是一个还没传完的标签开头。
func maybePartialTag(tail string) bool {
	if strings.HasPrefix(tagPrefix, tail) { // tail 是 "[motion:" 的真前缀（含 "[" 本身）
		return true
	}
	return strings.HasPrefix(tail, tagPrefix) && !strings.Contains(tail, "]")
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/service/`
Expected: PASS（7 个测试全绿）

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/
git commit -m "feat(server): service 层流式 motion 标签剥离过滤器"
```

---

### Task 6: 形象人设读取（assets.PersonaText）+ prompt 组装

**Files:**
- Create: `server/internal/assets/persona.go`
- Create: `server/internal/assets/persona_test.go`
- Create: `server/internal/service/prompt.go`
- Create: `server/internal/service/prompt_test.go`

**Interfaces:**
- Consumes: `dao.Message`（Task 4——history 元素类型）、`llm.Message`（Task 3）
- Produces: `assets.PersonaText(root, slug string) (string, bool)`；`service.SystemPrompt(persona string) string`；`service.BuildMessages(persona string, history []dao.Message, userText string, historyLimit int) []llm.Message`。Task 8 的 ChatService 消费。

- [ ] **Step 1: 写失败测试（assets.PersonaText）**

Create `server/internal/assets/persona_test.go`：

```go
package assets

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPersonaText(t *testing.T) {
	root := t.TempDir()
	writePersonaTree(t, root)

	if txt, ok := PersonaText(root, "haru"); !ok || txt != "你是猫。" {
		t.Fatalf("haru=%q ok=%v", txt, ok)
	}
	// slug 不存在 / 无 avatar.json → false
	if _, ok := PersonaText(root, "plain"); ok {
		t.Fatal("无 avatar.json 应 false")
	}
	// persona 指向的文件缺失 → false
	if _, ok := PersonaText(root, "metanull"); ok {
		t.Fatal("persona 文件缺失应 false")
	}
	// 路径穿越 → false（绝不读模型根目录之外）
	if _, ok := PersonaText(root, "evil"); ok {
		t.Fatal("穿越路径应 false")
	}
	// 非法 slug → false
	if _, ok := PersonaText(root, "../haru"); ok {
		t.Fatal("非法 slug 应 false")
	}
	// persona 文件为空 → false
	if _, ok := PersonaText(root, "empty"); ok {
		t.Fatal("空人设应 false")
	}
}

func writePersonaTree(t *testing.T, root string) {
	t.Helper()
	files := map[string]string{
		"haru/avatar.json":         `{"name":"haru","persona":"persona/haru.txt"}`,
		"haru/persona/haru.txt":    "  你是猫。  ",
		"plain/p.model3.json":      `{"Version":3}`,
		"metanull/avatar.json":     `{"name":"m","persona":"missing.txt"}`,
		"evil/avatar.json":         `{"name":"e","persona":"../../secret.txt"}`,
		"empty/avatar.json":        `{"name":"x","persona":"persona/empty.txt"}`,
		"empty/persona/empty.txt":  "   ",
	}
	for rel, content := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/assets/ -run PersonaText`
Expected: FAIL（`undefined: PersonaText`）

- [ ] **Step 3: 写实现**

Create `server/internal/assets/persona.go`：

```go
package assets

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// PersonaText 读取形象人设文本：avatar.json 的 persona 字段指向形象目录内的相对路径。
// 无 avatar.json / 无 persona / slug 非法 / 路径越界 / 文件缺失或为空 → ("", false)。
func PersonaText(root, slug string) (string, bool) {
	if !slugRe.MatchString(slug) || slug == "." || slug == ".." {
		return "", false
	}
	b, err := os.ReadFile(filepath.Join(root, slug, "avatar.json"))
	if err != nil {
		return "", false
	}
	var meta struct {
		Persona string `json:"persona"`
	}
	if json.Unmarshal(b, &meta) != nil || meta.Persona == "" {
		return "", false
	}
	dir := filepath.Join(root, slug)
	p := filepath.Join(dir, filepath.FromSlash(meta.Persona))
	// persona 相对路径必须仍在形象目录内（拒绝绝对路径与 .. 穿越）
	if !strings.HasPrefix(p, dir+string(filepath.Separator)) {
		return "", false
	}
	b, err = os.ReadFile(p)
	if err != nil {
		return "", false
	}
	txt := strings.TrimSpace(string(b))
	return txt, txt != ""
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/assets/ -run PersonaText`
Expected: PASS

- [ ] **Step 5: 写失败测试（service prompt）**

Create `server/internal/service/prompt_test.go`：

```go
package service

import (
	"strings"
	"testing"
	"time"

	"lovelybuddy/server/internal/dao"
)

func TestSystemPromptDefaultPersona(t *testing.T) {
	got := SystemPrompt("")
	if !strings.Contains(got, "桌面宠物") || !strings.Contains(got, "[motion:") {
		t.Fatalf("默认人设/动作协议缺失: %q", got)
	}
}

func TestSystemPromptCustomPersonaPrepends(t *testing.T) {
	got := SystemPrompt("你是猫。")
	if !strings.HasPrefix(got, "你是猫。") {
		t.Fatalf("自定义人设应在最前（稳定前缀缓存友好）: %q", got)
	}
	if !strings.Contains(got, "surprised") {
		t.Fatal("动作协议应包含全部意图说明")
	}
}

func TestBuildMessagesOrderAndTrim(t *testing.T) {
	history := []dao.Message{}
	for i := 0; i < 25; i++ {
		history = append(history, dao.Message{Role: "user", Content: "m" + string(rune('a'+i)), CreatedAt: time.Now()})
	}
	msgs := BuildMessages("你是猫。", history, "最新", 20)
	if len(msgs) != 22 { // system + 20 历史 + 1 输入
		t.Fatalf("len=%d", len(msgs))
	}
	if msgs[0].Role != "system" || !strings.HasPrefix(msgs[0].Content, "你是猫。") {
		t.Fatalf("首条应为 system 人设: %+v", msgs[0])
	}
	if msgs[len(msgs)-1].Role != "user" || msgs[len(msgs)-1].Content != "最新" {
		t.Fatalf("末条应为最新输入: %+v", msgs[len(msgs)-1])
	}
	if msgs[1].Content != "m" + string(rune('a'+5)) { // 裁掉最旧 5 条
		t.Fatalf("历史裁剪应保最近 20 条: %+v", msgs[1])
	}
}
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run Prompt`
Expected: FAIL（`undefined: SystemPrompt`）

- [ ] **Step 7: 写实现**

Create `server/internal/service/prompt.go`：

```go
package service

import (
	"fmt"
	"strings"

	"lovelybuddy/server/internal/dao"
	"lovelybuddy/server/internal/llm"
)

const defaultPersona = "你是用户的桌面宠物，性格活泼友善，喜欢陪伴用户。"

// SystemPrompt 人设 + 动作协议（spec §4：稳定前缀放最前，缓存友好——只有换人设才失效）。
// 动作意图集合与 renderer live2d/motionMap.ts 的 MotionIntent 保持一致。
func SystemPrompt(persona string) string {
	if strings.TrimSpace(persona) == "" {
		persona = defaultPersona
	}
	return fmt.Sprintf(`%s

回复规则：
- 用中文口语化聊天，一般不超过两句话，不说套话。
- 想做动作时在回复里嵌入恰好一个动作标签，格式 [motion:意图]，意图只能是：idle、tap、greet、thinking、speak、happy、sad、angry、surprised、bye、sleep。标签会被剥离后播放，不要解释它。
- 不使用 markdown、列表或代码块。`, persona)
}

// BuildMessages 组装请求（spec §4 顺序）：system（人设+动作协议）→ 历史 → 最新输入。
// 检索记忆是 M5 的注入位，M2 留空。历史只保留最近 historyLimit 条（裁最旧）。
func BuildMessages(persona string, history []dao.Message, userText string, historyLimit int) []llm.Message {
	if historyLimit > 0 && len(history) > historyLimit {
		history = history[len(history)-historyLimit:]
	}
	msgs := make([]llm.Message, 0, len(history)+2)
	msgs = append(msgs, llm.Message{Role: "system", Content: SystemPrompt(persona)})
	for _, m := range history {
		msgs = append(msgs, llm.Message{Role: m.Role, Content: m.Content})
	}
	msgs = append(msgs, llm.Message{Role: "user", Content: userText})
	return msgs
}
```

注：`Message` 类型已由 Task 4 的 `dao/chat.go` 定义，这里直接引用 `dao.Message`，不再重复定义。

- [ ] **Step 8: 跑测试确认通过**

Run: `cd server && go test ./internal/service/ ./internal/assets/`
Expected: PASS（全部）

- [ ] **Step 9: Commit**

```bash
git add server/internal/assets/persona.go server/internal/assets/persona_test.go server/internal/service/
git commit -m "feat(server): 形象人设读取与聊天 prompt 组装"
```

---

### Task 7: Go service 包 —— ChatStore 接口 + MemStore

**Files:**
- Create: `server/internal/service/memstore.go`
- Create: `server/internal/service/memstore_test.go`

**Interfaces:**
- Consumes: `dao.Message`（Task 4）、`dao.ChatDAO`（Task 4，隐式满足本接口）
- Produces: `service.ChatStore` 接口（`DefaultSession(ctx) (string, error)` / `Append(ctx, sessionID, role, content, motion string) error` / `History(ctx, sessionID string, limit int) ([]dao.Message, error)`）——消费侧接口（Go 惯例：接口由使用方定义），`*dao.ChatDAO` 与 `*MemStore` 都直接满足它；`service.NewMemStore() *MemStore`。Task 8 ChatService、Task 9 controller 测试消费。

注：PgStore 的 SQL 已在 Task 4（dao.ChatDAO）落地，本任务只补 service 侧抽象与内存实现。

- [ ] **Step 1: 写失败测试（MemStore，纯内存必跑）**

Create `server/internal/service/memstore_test.go`：

```go
package service

import (
	"context"
	"testing"
)

func TestMemStoreSessionAndMessages(t *testing.T) {
	ctx := context.Background()
	s := NewMemStore()

	id1, err := s.DefaultSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id2, _ := s.DefaultSession(ctx)
	if id1 != id2 {
		t.Fatalf("单会话模型应复用同一会话: %q vs %q", id1, id2)
	}

	if err := s.Append(ctx, id1, "user", "你好", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.Append(ctx, id1, "assistant", "你好呀", "happy"); err != nil {
		t.Fatal(err)
	}
	if err := s.Append(ctx, id1, "user", "再见", ""); err != nil {
		t.Fatal(err)
	}

	msgs, err := s.History(ctx, id1, 10)
	if err != nil || len(msgs) != 3 {
		t.Fatalf("len=%d err=%v", len(msgs), err)
	}
	if msgs[0].Content != "你好" || msgs[2].Content != "再见" {
		t.Fatalf("应按时间升序: %+v", msgs)
	}
	if msgs[1].Motion != "happy" {
		t.Fatalf("motion=%q", msgs[1].Motion)
	}

	limited, _ := s.History(ctx, id1, 2)
	if len(limited) != 2 || limited[0].Content != "你好呀" {
		t.Fatalf("limit 应取最近 N 条升序: %+v", limited)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run MemStore`
Expected: FAIL（`undefined: NewMemStore`）

- [ ] **Step 3: 写实现**

Create `server/internal/service/memstore.go`：

```go
package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"lovelybuddy/server/internal/dao"
)

// ChatStore 会话与消息持久化抽象（消费侧接口：生产 dao.ChatDAO / 测试 MemStore）。
// 方法集与 dao.ChatDAO 一致，两个实现都直接满足本接口。
type ChatStore interface {
	// DefaultSession 取最新会话，没有则创建（M2 单会话模型，title 固定）。
	DefaultSession(ctx context.Context) (string, error)
	Append(ctx context.Context, sessionID, role, content, motion string) error
	// History 最近 limit 条，按时间（id）升序返回。
	History(ctx context.Context, sessionID string, limit int) ([]dao.Message, error)
}

// MemStore 内存实现（单测 / server 集成测试用）。
type MemStore struct {
	mu       sync.Mutex
	sessions []string
	nextID   int
	msgs     map[string][]dao.Message
}

func NewMemStore() *MemStore { return &MemStore{msgs: map[string][]dao.Message{}} }

func (s *MemStore) DefaultSession(context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sessions) > 0 {
		return s.sessions[len(s.sessions)-1], nil
	}
	s.nextID++
	id := fmt.Sprintf("sess-%d", s.nextID)
	s.sessions = append(s.sessions, id)
	s.msgs[id] = nil
	return id, nil
}

func (s *MemStore) Append(_ context.Context, sessionID, role, content, motion string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.msgs[sessionID]; !ok {
		return errors.New("unknown session: " + sessionID)
	}
	s.msgs[sessionID] = append(s.msgs[sessionID],
		dao.Message{Role: role, Content: content, Motion: motion, CreatedAt: time.Now()})
	return nil
}

func (s *MemStore) History(_ context.Context, sessionID string, limit int) ([]dao.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, ok := s.msgs[sessionID]
	if !ok {
		return nil, errors.New("unknown session: " + sessionID)
	}
	if limit > 0 && len(all) > limit {
		all = all[len(all)-limit:]
	}
	out := make([]dao.Message, len(all))
	copy(out, all)
	return out, nil
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/service/ -run MemStore`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/
git commit -m "feat(server): service 层 ChatStore 抽象与内存实现"
```

---

### Task 8: Go service.ChatService —— 流式编排（meta/delta/motion/done/error + 停止半截入库）

**Files:**
- Create: `server/internal/service/chat.go`
- Create: `server/internal/service/chat_test.go`

**Interfaces:**
- Consumes: `service.ChatStore`（Task 7）、`llm.ChatProvider`（Task 3）、`service.NewMotionFilter`（Task 5）、`service.BuildMessages`（Task 6）、`assets.PersonaText`（Task 6）
- Produces: `service.Event`（JSON tag：`type`/`session_id,omitempty`/`text,omitempty`/`intent,omitempty`/`motion,omitempty`/`error,omitempty`；Type 取值 `meta|delta|motion|done|error`）；`service.NewChatService(store ChatStore, provider llm.ChatProvider, modelDir string) *ChatService`；`(*ChatService) Stream(ctx, avatarSlug, userText string) <-chan Event`；`(*ChatService) History(ctx, limit int) (string, []dao.Message, error)`。Task 9 controller 消费。

- [ ] **Step 1: 写失败测试**

Create `server/internal/service/chat_test.go`：

```go
package service

import (
	"context"
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
		"haru/avatar.json":      `{"persona":"p.txt"}`,
		"haru/p.txt":            "你是猫。",
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
```

`osWriteFiles` 是测试辅助（写目录树），放本测试文件底部：

```go
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
```

（import 补 `os`、`path/filepath`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run Stream`
Expected: FAIL（`undefined: NewChatService`）

- [ ] **Step 3: 写实现**

Create `server/internal/service/chat.go`：

```go
package service

import (
	"context"
	"strings"

	"lovelybuddy/server/internal/assets"
	"lovelybuddy/server/internal/dao"
	"lovelybuddy/server/internal/llm"
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

// historyLimit 每次请求注入的历史条数（spec §4 prompt 顺序中的「历史」段）。
const historyLimit = 20

type ChatService struct {
	store    ChatStore
	provider llm.ChatProvider
	modelDir string
}

func NewChatService(store ChatStore, provider llm.ChatProvider, modelDir string) *ChatService {
	return &ChatService{store: store, provider: provider, modelDir: modelDir}
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

// Stream 一次对话全流程（编排顺序固定，勿改）：
//  1. 未配 API key → 仅 error 事件（不建会话不落库）
//  2. DefaultSession → meta 事件
//  3. 读历史（不含本次输入）→ 落用户消息
//  4. persona（avatar.json，无则空）+ SystemPrompt + 历史 + 输入 → provider 流式
//  5. MotionFilter 净化：可见增量发 delta、识别意图发 motion
//  6. 正常结束 Flush；assistant（干净全文 + 最后意图）落库 → done
//  7. ctx 取消（用户停止）：半截内容照常落库后发 done（不算错误）
//  8. 上游失败：已有内容仍落库，最后发 error
func (s *ChatService) Stream(ctx context.Context, avatarSlug, userText string) <-chan Event {
	ch := make(chan Event)
	go func() {
		defer close(ch)
		if !s.provider.Configured() {
			ch <- Event{Type: "error", Error: "未配置 API key：请在 .env 填写 " + s.provider.KeyEnv() + " 后重启"}
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

		persona, _ := assets.PersonaText(s.modelDir, avatarSlug)
		filter := NewMotionFilter()
		var full strings.Builder
		lastMotion := ""
		for ev := range s.provider.StreamChat(ctx, BuildMessages(persona, history, userText, historyLimit)) {
			if ev.Err != nil {
				s.persistPartial(sessionID, full.String(), lastMotion)
				ch <- Event{Type: "error", Error: "模型调用失败: " + ev.Err.Error()}
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
```

注意 `TestStreamStopPersistsPartial` 的时序：cancel 后 provider 的 run 返回 → Stream 的 for-range 结束 → Flush/Append/done。done 事件的发送对象（HTTP 连接）已断，但通道消费者是测试/路由循环，通道本身照常工作。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/service/`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/chat.go server/internal/service/chat_test.go
git commit -m "feat(server): ChatService 流式编排（停止半截入库）"
```

---

### Task 9: SSE 与历史接口（controller/chat.go + router 扩展）+ main.go 接线

**Files:**
- Create: `server/internal/controller/chat.go`（Send SSE / History 接口处理）
- Modify: `server/internal/router/router.go`（挂 chat 路由；`Register` 增 chats 参数）
- Modify: `server/internal/server/server.go`（`New` 增 chats 参数透传给 Register）
- Modify: `server/internal/server/server_test.go`（newTestServer 组装 ChatService + 假 provider；新增 chat 接口测试）
- Modify: `server/cmd/lovely-buddy-server/main.go`（config/llm/dao/service 接线）

**Interfaces:**
- Consumes: `service.NewChatService/NewMemStore`（Task 7/8）、`llm.Resolve`（Task 3）、`config.Load`（Task 2）、`dao.NewChat`（Task 4）
- Produces（线上 API 契约，renderer Task 11 与之对齐）：
  - `POST /api/v1/chat` body `{"avatar"?: string, "message": string}` → `text/event-stream`，事件按 Task 8 `service.Event` JSON（`event:` 行 + `data:` 行成对，`data` 即完整 Event 对象）。message 必填、trim 后非空、≤ 4000 字，否则 `400 {"error"}`。
  - `GET /api/v1/history?limit=50` → `{"session_id": string, "messages": [{role, content, motion?, created_at}]}`（limit 夹在 1..200）。
  - `controller.NewChat(chats *service.ChatService) *Chat`（`Send`/`History` handlers）；`router.Register(r, pool, token, modelDir, chats *service.ChatService)`；`server.New(addr, token string, pool *pgxpool.Pool, modelDir string, chats *service.ChatService)`。

- [ ] **Step 1: 写失败测试**

在 `server_test.go` 追加（同包，复用已有 helper；文件顶部 import 增 `io`、`strings`、`"lovelybuddy/server/internal/llm"`、`"lovelybuddy/server/internal/service"`）：

```go
// scriptedLLM 与 service 包测试的假 provider 同构（server 包本地一份，避免导出测试工具）。
type scriptedLLM struct{}

func (scriptedLLM) StreamChat(_ context.Context, _ []llm.Message) <-chan llm.StreamEvent {
	ch := make(chan llm.StreamEvent)
	go func() {
		defer close(ch)
		ch <- llm.StreamEvent{Delta: "你好"}
		ch <- llm.StreamEvent{Delta: "[motion:happy]呀"}
	}()
	return ch
}
func (scriptedLLM) Configured() bool { return true }
func (scriptedLLM) KeyEnv() string   { return "DEEPSEEK_API_KEY" }
```

并把 `newTestServer` 改为（原调用方 `ts, root := newTestServer(t)` 签名不变）：

```go
func newTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	chats := service.NewChatService(service.NewMemStore(), scriptedLLM{}, root)
	srv := New("127.0.0.1:0", testToken, nil, root, chats)
	ts := httptest.NewServer(srv.Handler)
	t.Cleanup(ts.Close)
	return ts, root
}
```

新增测试：

```go
func TestChatAuthAndValidation(t *testing.T) {
	ts, _ := newTestServer(t)
	// 无 token → 401
	resp, _ := doJSON(t, http.MethodPost, ts.URL+"/api/v1/chat", "", map[string]any{"message": "hi"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("无 token 应 401, got %d", resp.StatusCode)
	}
	// 空消息 → 400
	resp, m := doJSON(t, http.MethodPost, ts.URL+"/api/v1/chat", testToken, map[string]any{"message": "  "})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("空消息应 400, got %d %v", resp.StatusCode, m)
	}
}

func TestChatSSEStream(t *testing.T) {
	ts, _ := newTestServer(t)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/chat",
		strings.NewReader(`{"message":"嗨"}`))
	req.Header.Set("Authorization", "Bearer "+testToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type=%s", ct)
	}
	body, _ := io.ReadAll(resp.Body)
	s := string(body)
	for _, want := range []string{
		"event: meta", `"type":"meta"`,
		"event: delta", `"text":"你好"`,
		"event: motion", `"intent":"happy"`,
		"event: done", `"text":"你好呀"`,
	} {
		if !strings.Contains(s, want) {
			t.Fatalf("SSE 缺 %q:\n%s", want, s)
		}
	}
}

func TestHistoryAfterChat(t *testing.T) {
	ts, _ := newTestServer(t)
	// 先聊一句（SSE 全量读完即完成）
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/chat",
		strings.NewReader(`{"message":"嗨"}`))
	req.Header.Set("Authorization", "Bearer "+testToken)
	resp, _ := http.DefaultClient.Do(req)
	_, _ = io.ReadAll(resp.Body)
	resp.Body.Close()

	resp2, m := doJSON(t, http.MethodGet, ts.URL+"/api/v1/history", testToken, nil)
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("history 应 200, got %d %v", resp2.StatusCode, m)
	}
	msgs, _ := m["messages"].([]any)
	if len(msgs) != 2 {
		t.Fatalf("应有 user+assistant 两条: %v", m)
	}
	last := msgs[1].(map[string]any)
	if last["content"] != "你好呀" || last["motion"] != "happy" {
		t.Fatalf("assistant 落库不符: %v", last)
	}
	if _, ok := m["session_id"].(string); !ok {
		t.Fatalf("应含 session_id: %v", m)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/server/`
Expected: FAIL（编译错误：`New` 参数不符 / 路由 404）

- [ ] **Step 3: 写实现**

Create `server/internal/controller/chat.go`（SSE 写出与参数校验在接口层，编排全在 service）：

```go
package controller

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/service"
)

// Chat 聊天接口（流式编排全在 service.ChatService，本层只做 HTTP 胶水）。
type Chat struct{ svc *service.ChatService }

func NewChat(svc *service.ChatService) *Chat { return &Chat{svc: svc} }

// Send POST /api/v1/chat → text/event-stream（事件流直至 done/error）。
// 客户端断开（停止生成）时 c.Request.Context() 取消，service 照常半截入库后收尾。
func (h *Chat) Send(c *gin.Context) {
	if h.svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "chat 服务未初始化"})
		return
	}
	var req struct {
		Avatar  string `json:"avatar"`
		Message string `json:"message"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" || len(req.Message) > 4000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message 必填且不超过 4000 字"})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.Flush()
	for ev := range h.svc.Stream(c.Request.Context(), req.Avatar, req.Message) {
		payload, _ := json.Marshal(ev)
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", ev.Type, payload)
		c.Writer.Flush()
	}
}

// History GET /api/v1/history?limit=50 → {session_id, messages}（limit 夹 1..200）。
func (h *Chat) History(c *gin.Context) {
	if h.svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "chat 服务未初始化"})
		return
	}
	limit := 50
	if v, err := strconv.Atoi(c.Query("limit")); err == nil {
		limit = v
	}
	limit = min(max(limit, 1), 200)
	id, msgs, err := h.svc.History(c.Request.Context(), limit)
	if err != nil {
		slog.Error("chat: 历史读取失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "历史读取失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session_id": id, "messages": msgs})
}
```

`server/internal/router/router.go`：import 增 `"lovelybuddy/server/internal/service"`；`Register` 增第 5 参并在 assets 路由后追加：

```go
// Register 注册全部路由（在 engine 挂完全局中间件之后调用）。
// chats 由 main 组装传入（nil 时 chat 接口返回 503）。
func Register(r *gin.Engine, pool *pgxpool.Pool, token, modelDir string, chats *service.ChatService) {
	r.GET("/healthz", controller.NewHealthz(pool))

	api := r.Group("/api/v1", middleware.Token(token))
	assetsCtl := controller.NewAssets(modelDir)
	api.GET("/ping", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"pong": true}) })
	api.GET("/assets", assetsCtl.List)
	api.POST("/assets/import", assetsCtl.Import)
	api.DELETE("/assets/:slug", assetsCtl.Delete)
	chatCtl := controller.NewChat(chats)
	api.POST("/chat", chatCtl.Send)
	api.GET("/history", chatCtl.History)
}
```

`server/internal/server/server.go`：import 增 `"lovelybuddy/server/internal/service"`，`New` 增参并透传（仍只做组装）：

```go
// New 组装 HTTP 服务。pool 可为 nil（healthz 将报 db error）；chats 为聊天服务。
func New(addr, token string, pool *pgxpool.Pool, modelDir string, chats *service.ChatService) *http.Server {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(middleware.AccessLog(), gin.Recovery(), middleware.CORS())
	router.Register(r, pool, token, modelDir, chats)
	return &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
}
```

`server/cmd/lovely-buddy-server/main.go`：import 增 `"lovelybuddy/server/internal/config"`、`"lovelybuddy/server/internal/dao"`、`"lovelybuddy/server/internal/llm"`、`"lovelybuddy/server/internal/service"`；在 `srv := server.New(...)` 前插入：

```go
	cfg := config.Load()
	provider, err := llm.Resolve(cfg.Chat.Provider, cfg.Chat.Model, cfg.Chat.BaseURL)
	if err != nil {
		slog.Error("对话厂商配置无效", "err", err)
		os.Exit(1)
	}
	chats := service.NewChatService(dao.NewChat(pool), provider, *modelDir)
	srv := server.New(*addr, *token, pool, *modelDir, chats)
```

（原 `srv := server.New(*addr, *token, pool, *modelDir)` 行整体替换。分层接线：main 组装依赖 → server 只组装 HTTP → router 装配路由 → controller 接口 → service 业务 → dao 数据。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go vet ./... && go test ./...`
Expected: PASS（全部包）

- [ ] **Step 5: 手工冒烟（可选但推荐）**

```bash
make db && cd server && go run ./cmd/lovely-buddy-server &
curl -sN -H "Authorization: Bearer dev" -H "Content-Type: application/json" \
  -d '{"message":"你好"}' http://127.0.0.1:8740/api/v1/chat
# 未配 key 时应收到 error 事件；.env 填 DEEPSEEK_API_KEY 后应见 meta/delta 流
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add server/internal/controller/ server/internal/router/ server/internal/server/ server/cmd/
git commit -m "feat(server): chat SSE 与历史接口（controller 接口层 + router 装配）"
```

---

### Task 10: 桌面端窗口扩展改「按键位记账」（菜单/聊天共存）

**Files:**
- Modify: `apps/desktop/src/main/window/manager.ts`（expandFor/collapseFor 替代 expand/collapse）
- Modify: `apps/desktop/src/main/ipc.ts`（expand/collapse IPC 带 key）
- Modify: `apps/desktop/src/preload/index.ts`（签名加 key）
- Modify: `apps/desktop/src/renderer/src/env.d.ts`（签名加 key）
- Modify: `apps/desktop/src/renderer/src/pet/usePetMenu.ts`（传 `'menu'`）
- Modify: `apps/desktop/src/main/window/__test__/bounds.test.ts`（无逻辑变化则只跑一遍确认仍绿）
- Modify: `apps/desktop/src/renderer/src/pet/__test__/usePetMenu.test.ts`（断言带 key）

**Interfaces:**
- Consumes: 现有 `expandBounds/collapseBounds`（bounds.ts 纯函数不变）
- Produces（Task 12/13 消费）：`window.lovelybuddy.expandWindow(key: string, extraWidth: number, extraHeight: number) => Promise<{width, height}>`；`collapseWindow(key: string) => void`。key 约定：`'menu'` | `'chat'`。IPC 频道名不变（`lovelybuddy:expand-window`/`lovelybuddy:collapse-window`），参数首位加 key。

**背景**：现扩展机制只有一层 `expandedBase`——聊天流式期间（窗口需保持扩展给气泡留空间）用户开/关菜单会把窗口缩回聊天扩展前的基准，气泡区被裁。改为按 key 记账：`extras` Map 存各面板扩展量，bounds 永远从基准 + 全部活跃扩展量重算；最后一个 key 移除时才缩回基准。

- [ ] **Step 1: 改测试（先红）**

`usePetMenu.test.ts` 两处断言加 key：

```ts
expect(expandWindow).toHaveBeenCalledWith('menu', MENU_W + 4 - 164, MENU_H + 12)
```

```ts
expect(expandWindow).toHaveBeenCalledWith('menu', 0, MENU_H + 12)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/__test__/usePetMenu.test.ts`
Expected: FAIL（收到三参调用不匹配两参断言——此时实现还没改，测试期望的是带 key 的调用）

- [ ] **Step 3: 写实现**

`manager.ts`：删除 `expand`/`collapse` 方法与注释里的「菜单」措辞，替换为：

```ts
  // 各面板（菜单/聊天）的扩展量记账；bounds 从基准 + 全部活跃扩展量重算
  private extras = new Map<string, { width: number; height: number }>()

  /** 面板打开：按 key 记账扩展量（右下角固定、向左上扩，从展开基准重算）。 */
  expandFor(key: string, extraWidth: number, extraHeight: number): { width: number; height: number } {
    const w = this.win
    if (!w) return { width: 0, height: 0 }
    if (!this.expandedBase) this.expandedBase = w.getBounds()
    this.extras.set(key, { width: extraWidth, height: extraHeight })
    return this.applyExtras()
  }

  /** 面板关闭：去掉该 key；全部关闭后缩回基准（右下角固定）。 */
  collapseFor(key: string): void {
    const w = this.win
    if (!w) return
    this.extras.delete(key)
    if (this.extras.size === 0) {
      if (this.expandedBase) {
        w.setBounds(collapseBounds(w.getBounds(), this.expandedBase))
        this.expandedBase = null
      }
      return
    }
    this.applyExtras()
  }

  // 从基准叠加全部活跃扩展量一次性重算（避免逐面板叠加漂移/夹紧误差累积）
  private applyExtras(): { width: number; height: number } {
    const w = this.win
    if (!w || !this.expandedBase) return { width: 0, height: 0 }
    let extraW = 0
    let extraH = 0
    for (const e of this.extras.values()) {
      extraW += e.width
      extraH += e.height
    }
    const base = this.expandedBase
    const wa = screen.getDisplayMatching(base).workArea
    const next = expandBounds(base, extraW, extraH, wa)
    w.setBounds(next)
    return { width: next.width, height: next.height }
  }
```

（`resizeToModel` 里 `if (this.expandedBase) this.expandedBase = w.getBounds()` 的行为保持不变——展开态下切模型基准随新尺寸更新。）

`ipc.ts` 两个 handler 替换：

```ts
  ipcMain.handle('lovelybuddy:expand-window', (_e, key: string, extraWidth: number, extraHeight: number) =>
    win.expandFor(key, extraWidth, extraHeight))
  ipcMain.on('lovelybuddy:collapse-window', (_e, key: string) => win.collapseFor(key))
```

`preload/index.ts`：

```ts
  /** 面板打开：向左上扩展窗口（右下角固定，key 记账可多面板共存），返回扩展后实际尺寸 */
  expandWindow: (key: string, extraWidth: number, extraHeight: number) =>
    ipcRenderer.invoke('lovelybuddy:expand-window', key, extraWidth, extraHeight),
  /** 面板关闭：去掉该 key 的扩展量，全部关闭后缩回基准 */
  collapseWindow: (key: string) => ipcRenderer.send('lovelybuddy:collapse-window', key),
```

`env.d.ts` 同步签名（注释与 preload 一致）。

`usePetMenu.ts` 的 `openMenu`/`closeMenu`：

```ts
    void window.lovelybuddy.expandWindow('menu', extraW, extraH).then(() => {
      if (token !== tokenRef.current) return
      setMenu({ x, y })
    })
```

```ts
    window.lovelybuddy.collapseWindow('menu')
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/__test__/usePetMenu.test.ts src/main/window/__test__/bounds.test.ts && pnpm typecheck`
Expected: PASS（bounds 纯函数未动，应仍绿；typecheck 覆盖 preload/env.d.ts/usePetMenu 签名一致）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "refactor(desktop): 窗口扩展改多键位记账（菜单/聊天共存）"
```

---

### Task 11: renderer chatApi —— SSE 客户端

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/chatApi.ts`
- Create: `apps/desktop/src/renderer/src/lib/__test__/chatApi.test.ts`

**Interfaces:**
- Consumes: `ApiRuntime`（`lib/assetsApi.ts`）、Task 9 线上契约
- Produces（Task 12 消费）：
  - `type ChatStreamEvent = { type: 'meta'; session_id: string } | { type: 'delta'; text: string } | { type: 'motion'; intent: string } | { type: 'done'; text: string; motion?: string } | { type: 'error'; error: string }`
  - `parseSSEBlock(block: string): ChatStreamEvent | null`
  - `streamChat(rt, body: { avatar?: string; message: string }, onEvent: (ev) => void, signal?: AbortSignal): Promise<void>`
  - `getHistory(rt, limit = 50): Promise<{ session_id: string; messages: ChatHistoryItem[] }>`
  - `interface ChatHistoryItem { role: 'user' | 'assistant'; content: string; motion?: string; created_at: string }`

- [ ] **Step 1: 写失败测试**

Create `apps/desktop/src/renderer/src/lib/__test__/chatApi.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHistory, parseSSEBlock, streamChat } from '../chatApi'
import type { ApiRuntime } from '../assetsApi'

const rt: ApiRuntime = { baseUrl: 'http://127.0.0.1:8740', token: 'dev' }

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    }
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('parseSSEBlock', () => {
  it('解析 data 行为事件对象', () => {
    expect(parseSSEBlock('event: delta\ndata: {"type":"delta","text":"你"}')).toEqual({
      type: 'delta',
      text: '你'
    })
  })
  it('无 data / 坏 JSON / 未知类型 → null', () => {
    expect(parseSSEBlock('event: ping')).toBeNull()
    expect(parseSSEBlock('data: not-json')).toBeNull()
    expect(parseSSEBlock('data: {"type":"weird"}')).toBeNull()
  })
})

describe('streamChat', () => {
  afterEach(() => vi.restoreAllMocks())

  it('按块解析事件并回调（跨 chunk 的 SSE 块）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: meta\ndata: {"type":"meta","session_id":"s1"}\n\n',
        'event: delta\ndata: {"type":"delta","text":"你"}\n\nevent: mot',
        'ion\ndata: {"type":"motion","intent":"happy"}\n\nevent: done\ndata: {"type":"done","text":"你","motion":"happy"}\n\n'
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const events: unknown[] = []
    await streamChat(rt, { message: 'hi' }, (ev) => events.push(ev))
    expect(events.map((e) => (e as { type: string }).type)).toEqual(['meta', 'delta', 'motion', 'done'])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8740/api/v1/chat',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('HTTP 400 抛服务端错误信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"message 必填"}', { status: 400 }))
    )
    await expect(streamChat(rt, { message: '' }, () => {})).rejects.toThrow('message 必填')
  })
})

describe('getHistory', () => {
  afterEach(() => vi.restoreAllMocks())

  it('映射历史消息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          '{"session_id":"s1","messages":[{"role":"user","content":"嗨","created_at":"2026-10-23T00:00:00Z"},{"role":"assistant","content":"你好呀","motion":"happy","created_at":"2026-10-23T00:00:01Z"}]}',
          { status: 200 }
        )
      )
    )
    const h = await getHistory(rt)
    expect(h.session_id).toBe('s1')
    expect(h.messages).toHaveLength(2)
    expect(h.messages[1]?.motion).toBe('happy')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/lib/__test__/chatApi.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

Create `apps/desktop/src/renderer/src/lib/chatApi.ts`：

```ts
// 聊天 API 客户端：POST /api/v1/chat 读 SSE 流（fetch + ReadableStream 手解，
// EventSource 不支持 POST/鉴权头），事件对象与 Go service.Event 的 JSON 对齐。
import type { ApiRuntime } from './assetsApi'

export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
  motion?: string
  created_at: string
}

export type ChatStreamEvent =
  | { type: 'meta'; session_id: string }
  | { type: 'delta'; text: string }
  | { type: 'motion'; intent: string }
  | { type: 'done'; text: string; motion?: string }
  | { type: 'error'; error: string }

const EVENT_TYPES = ['meta', 'delta', 'motion', 'done', 'error']

/** 解析一个 SSE 块（"event: x\\ndata: y"）→ 事件对象；无 data/坏 JSON/未知类型 → null。 */
export function parseSSEBlock(block: string): ChatStreamEvent | null {
  const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) return null
  try {
    const ev = JSON.parse(dataLine.slice(5).trim()) as ChatStreamEvent
    if (!EVENT_TYPES.includes(ev.type)) return null
    return ev
  } catch {
    return null
  }
}

export async function streamChat(
  rt: ApiRuntime,
  body: { avatar?: string; message: string },
  onEvent: (ev: ChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${rt.baseUrl}/api/v1/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rt.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `发送失败: HTTP ${res.status}`)
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const ev = parseSSEBlock(block)
      if (ev) onEvent(ev)
    }
  }
}

export async function getHistory(
  rt: ApiRuntime,
  limit = 50
): Promise<{ session_id: string; messages: ChatHistoryItem[] }> {
  const res = await fetch(`${rt.baseUrl}/api/v1/history?limit=${limit}`, {
    headers: { Authorization: `Bearer ${rt.token}` }
  })
  if (!res.ok) throw new Error(`历史读取失败: HTTP ${res.status}`)
  return (await res.json()) as { session_id: string; messages: ChatHistoryItem[] }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/lib/__test__/chatApi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/
git commit -m "feat(desktop): chat SSE 客户端 chatApi"
```

---

### Task 12: renderer chatStore —— 发送/停止/刷新

**Files:**
- Create: `apps/desktop/src/renderer/src/store/chatStore.ts`
- Create: `apps/desktop/src/renderer/src/store/__test__/chatStore.test.ts`

**Interfaces:**
- Consumes: `streamChat/getHistory/ChatStreamEvent`（Task 11）、`window.lovelybuddy.getRuntime`
- Produces（Task 13/14/15 消费）：`useChatStore`；state：`items: ChatItem[]`、`sessionId: string | null`、`sending: boolean`、`error: string | null`、`lastMotion: { intent: string; seq: number } | null`（seq 单调递增，一次 motion 一个序号）；actions：`send(text: string, avatar?: string): Promise<void>`、`stop(): void`、`refresh(): Promise<void>`；`interface ChatItem { role: 'user' | 'assistant'; content: string; motion?: string }`

- [ ] **Step 1: 写失败测试**

Create `apps/desktop/src/renderer/src/store/__test__/chatStore.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chatStore'

// mock chatApi：捕获 onEvent，由测试手动驱动事件流
const streamChatMock = vi.fn()
const getHistoryMock = vi.fn()
vi.mock('../../lib/chatApi', () => ({
  streamChat: (...args: unknown[]) => streamChatMock(...args),
  getHistory: (...args: unknown[]) => getHistoryMock(...args)
}))

function driveSend(events: object[]): Promise<void> {
  streamChatMock.mockImplementation(
    (_rt: unknown, _body: unknown, onEvent: (ev: object) => void) => {
      for (const e of events) onEvent(e)
      return Promise.resolve()
    }
  )
  return useChatStore.getState().send('嗨', 'haru')
}

beforeEach(() => {
  useChatStore.setState({ items: [], sessionId: null, sending: false, error: null, lastMotion: null })
  streamChatMock.mockReset()
  getHistoryMock.mockReset()
  vi.stubGlobal('lovelybuddy', { getRuntime: () => Promise.resolve({ baseUrl: 'http://x', token: 't' }) })
})

afterEach(() => vi.unstubAllGlobals())

describe('chatStore.send', () => {
  it('乐观插入 user + assistant 占位，delta 累加，done 收口', async () => {
    await driveSend([
      { type: 'meta', session_id: 's1' },
      { type: 'delta', text: '你' },
      { type: 'delta', text: '好' },
      { type: 'motion', intent: 'happy' },
      { type: 'done', text: '你好', motion: 'happy' }
    ])
    const s = useChatStore.getState()
    expect(s.sessionId).toBe('s1')
    expect(s.items).toEqual([
      { role: 'user', content: '嗨' },
      { role: 'assistant', content: '你好', motion: 'happy' }
    ])
    expect(s.sending).toBe(false)
    expect(s.lastMotion).toMatchObject({ intent: 'happy' })
  })

  it('sending 期间重复 send 被忽略', async () => {
    streamChatMock.mockImplementation(() => new Promise<void>(() => {})) // 永不完成
    const p1 = useChatStore.getState().send('第一条')
    await useChatStore.getState().send('第二条')
    expect(useChatStore.getState().items).toHaveLength(2) // 只有第一条的 user+占位
    void p1
  })

  it('error 事件置错误并移除空占位', async () => {
    await driveSend([{ type: 'meta', session_id: 's1' }, { type: 'error', error: '未配置 API key' }])
    const s = useChatStore.getState()
    expect(s.error).toBe('未配置 API key')
    expect(s.items).toEqual([{ role: 'user', content: '嗨' }])
  })

  it('stop 触发 abort（保留半截内容，不算错误）', async () => {
    streamChatMock.mockImplementation(
      (_rt: unknown, _body: unknown, _onEvent: unknown, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          const abortIt = (): void => reject(new DOMException('aborted', 'AbortError'))
          // stop() 可能先于 streamChat 调用（send 先 await getRuntime）：已 abort 的信号不补发事件
          if (signal.aborted) abortIt()
          else signal.addEventListener('abort', abortIt)
        })
    )
    const p = useChatStore.getState().send('长问题')
    // 模拟流式中已收到部分内容
    useChatStore.setState((s) => ({
      items: [...s.items.slice(0, -1), { role: 'assistant' as const, content: '半截' }]
    }))
    useChatStore.getState().stop()
    await p
    const s = useChatStore.getState()
    expect(s.sending).toBe(false)
    expect(s.error).toBeNull()
    expect(s.items[s.items.length - 1]).toEqual({ role: 'assistant', content: '半截' })
  })
})

describe('chatStore.refresh', () => {
  it('拉取历史覆盖 items', async () => {
    getHistoryMock.mockResolvedValue({
      session_id: 's1',
      messages: [
        { role: 'user', content: '嗨', created_at: 't' },
        { role: 'assistant', content: '你好', motion: 'happy', created_at: 't' }
      ]
    })
    await useChatStore.getState().refresh()
    const s = useChatStore.getState()
    expect(s.sessionId).toBe('s1')
    expect(s.items).toEqual([
      { role: 'user', content: '嗨' },
      { role: 'assistant', content: '你好', motion: 'happy' }
    ])
  })

  it('后端离线时保持现状不抛错', async () => {
    getHistoryMock.mockRejectedValue(new Error('offline'))
    useChatStore.setState({ items: [{ role: 'user', content: '旧' }] })
    await expect(useChatStore.getState().refresh()).resolves.toBeUndefined()
    expect(useChatStore.getState().items).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/store/__test__/chatStore.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

Create `apps/desktop/src/renderer/src/store/chatStore.ts`：

```ts
// 聊天状态：发送（乐观插入 + SSE 累加）、停止（abort，半截保留）、历史刷新（断线恢复）。
import { create } from 'zustand'
import { getHistory, streamChat } from '../lib/chatApi'

export interface ChatItem {
  role: 'user' | 'assistant'
  content: string
  motion?: string
}

interface ChatState {
  items: ChatItem[]
  sessionId: string | null
  /** 一次发送进行中（流式接收或请求未结束） */
  sending: boolean
  error: string | null
  /** 最近一次 motion 事件（气泡驱动模型动作），seq 单调递增防同意图去重 */
  lastMotion: { intent: string; seq: number } | null
  send(text: string, avatar?: string): Promise<void>
  stop(): void
  refresh(): Promise<void>
}

let abort: AbortController | null = null
let motionSeq = 0

export const useChatStore = create<ChatState>()((set, get) => ({
  items: [],
  sessionId: null,
  sending: false,
  error: null,
  lastMotion: null,

  async send(text, avatar) {
    const msg = text.trim()
    if (!msg || get().sending) return
    set((s) => ({
      items: [...s.items, { role: 'user', content: msg }, { role: 'assistant', content: '' }],
      sending: true,
      error: null
    }))
    abort = new AbortController()
    const updateLast = (fn: (item: ChatItem) => ChatItem): void => {
      set((s) => {
        const items = [...s.items]
        items[items.length - 1] = fn(items[items.length - 1])
        return { items }
      })
    }
    try {
      const rt = await window.lovelybuddy.getRuntime()
      await streamChat(
        rt,
        { avatar, message: msg },
        (ev) => {
          if (ev.type === 'meta') set({ sessionId: ev.session_id })
          else if (ev.type === 'delta') updateLast((it) => ({ ...it, content: it.content + ev.text }))
          else if (ev.type === 'motion') set({ lastMotion: { intent: ev.intent, seq: ++motionSeq } })
          else if (ev.type === 'done') updateLast((it) => ({ ...it, content: ev.text, motion: ev.motion || undefined }))
          else if (ev.type === 'error') set({ error: ev.error })
        },
        abort.signal
      )
    } catch (e) {
      // 用户主动停止不算错误（服务端会把半截落库，下次 refresh 对齐）
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        set({ error: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      abort = null
      set((s) => {
        const items = s.items
        const last = items[items.length - 1]
        if (last && last.role === 'assistant' && last.content === '') {
          return { items: items.slice(0, -1), sending: false } // 空占位（直连失败）移除
        }
        return { sending: false }
      })
    }
  },

  stop() {
    abort?.abort()
  },

  async refresh() {
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const h = await getHistory(rt)
      set({
        sessionId: h.session_id,
        items: h.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.motion ? { motion: m.motion } : {})
        })),
        error: null
      })
    } catch {
      // 后端离线保持现状；健康恢复后由调用方再触发
    }
  }
}))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/store/__test__/chatStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/store/
git commit -m "feat(desktop): chatStore 发送/停止/刷新"
```

---

### Task 13: 模型总线 + 聊天面板 + 菜单入口

**Files:**
- Create: `apps/desktop/src/renderer/src/live2d/modelBus.ts`
- Create: `apps/desktop/src/renderer/src/pet/chat/useChatPanel.ts`
- Create: `apps/desktop/src/renderer/src/pet/chat/ChatPanel.tsx`
- Create: `apps/desktop/src/renderer/src/pet/chat/__test__/useChatPanel.test.ts`
- Create: `apps/desktop/src/renderer/src/pet/chat/__test__/ChatPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pet/PetCanvas.tsx`（注册 modelBus；穿透状态机感知 chatOpen）
- Modify: `apps/desktop/src/renderer/src/pet/PetMenu.tsx`（「聊天」入口）
- Modify: `apps/desktop/src/renderer/src/App.tsx`（挂 ChatPanel）
- Modify: `apps/desktop/src/renderer/src/styles/index.css`（面板样式）
- Modify: `apps/desktop/src/renderer/src/pet/__test__/PetMenu.test.tsx`（聊天按钮用例）

**Interfaces:**
- Consumes: `useChatStore`（Task 12）、`usePetStore`（取当前 avatar slug）、`expandWindow/collapseWindow(key,…)`（Task 10）
- Produces（Task 14/15 消费）：`getActiveModel(): PetModel | null` / `setActiveModel(pet: PetModel | null): void`（modelBus）；`useChatPanel(): { open: boolean; openPanel: () => void; closePanel: () => void }`；`CHAT_H = 240`；`<ChatPanel onClose={...} />`；PetMenu 新 prop `onChat: () => void`；PetCanvas 新 prop `chatOpen: boolean`

- [ ] **Step 1: 写失败测试（useChatPanel）**

Create `apps/desktop/src/renderer/src/pet/chat/__test__/useChatPanel.test.ts`（对照 `usePetMenu.test.ts` 的 mock 风格）：

```ts
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatPanel, CHAT_H } from '../useChatPanel'
import { useChatStore } from '../../../store/chatStore'

const expandWindow = vi.fn()
const collapseWindow = vi.fn()
const setPassthrough = vi.fn()

function mockLovelybuddy(): void {
  expandWindow.mockReset().mockResolvedValue({ width: 400, height: 800 })
  collapseWindow.mockReset()
  setPassthrough.mockReset()
  vi.stubGlobal('lovelybuddy', { expandWindow, collapseWindow, setPassthrough })
}

describe('useChatPanel', () => {
  beforeEach(() => {
    mockLovelybuddy()
    useChatStore.setState({ sending: false })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('openPanel 用 chat 键位向上扩展 CHAT_H，完成后 open=true', async () => {
    const { result } = renderHook(() => useChatPanel())
    act(() => result.current.openPanel())
    expect(expandWindow).toHaveBeenCalledWith('chat', 0, CHAT_H)
    await waitFor(() => expect(result.current.open).toBe(true))
  })

  it('closePanel 缩回并恢复穿透', async () => {
    const { result } = renderHook(() => useChatPanel())
    act(() => result.current.openPanel())
    await waitFor(() => expect(result.current.open).toBe(true))
    act(() => result.current.closePanel())
    expect(result.current.open).toBe(false)
    expect(collapseWindow).toHaveBeenCalledWith('chat')
    expect(setPassthrough).toHaveBeenCalledWith(true)
  })

  it('面板关闭但流式中：保持扩展；流式结束：自动缩回', async () => {
    const { result } = renderHook(() => useChatPanel())
    useChatStore.setState({ sending: true })
    act(() => result.current.openPanel())
    await waitFor(() => expect(result.current.open).toBe(true))
    act(() => result.current.closePanel())
    expect(result.current.open).toBe(false)
    expect(collapseWindow).not.toHaveBeenCalled() // sending=true 保持扩展（气泡要空间）
    act(() => useChatStore.setState({ sending: false }))
    await waitFor(() => expect(collapseWindow).toHaveBeenCalledWith('chat'))
  })

  it('Esc / 点面板外关闭', async () => {
    const { result } = renderHook(() => useChatPanel())
    act(() => result.current.openPanel())
    await waitFor(() => expect(result.current.open).toBe(true))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.open).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/chat/__test__/useChatPanel.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现（modelBus + useChatPanel）**

Create `apps/desktop/src/renderer/src/live2d/modelBus.ts`：

```ts
// 模型实例总线：PetCanvas 加载/销毁时登记，气泡等 UI 借此驱动模型播动作。
// 不用 zustand：PetModel 是命令式 facade（pixi 句柄），进 store 只会引来无意义的重渲染。
import type { PetModel } from './model'

let active: PetModel | null = null

export function setActiveModel(pet: PetModel | null): void {
  active = pet
}

export function getActiveModel(): PetModel | null {
  return active
}
```

Create `apps/desktop/src/renderer/src/pet/chat/useChatPanel.ts`：

```ts
import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../store/chatStore'

/** 聊天区在窗口上方扩展的高度（px）：历史列表 + 输入框 */
export const CHAT_H = 240

/**
 * 聊天面板状态机（对照 usePetMenu）：
 * - 窗口扩展条件 = 面板打开 || 正在流式回复（面板关了气泡还得有地方显示）
 * - openPanel 带 递增令牌（防「点开又立刻关掉」竞态，expandWindow resolve 后不再 setOpen）
 * - Esc / 点面板外（非 data-interactive）关闭
 */
export function useChatPanel(): { open: boolean; openPanel: () => void; closePanel: () => void } {
  const [open, setOpen] = useState(false)
  const tokenRef = useRef(0)
  const expandedRef = useRef(false)
  const sending = useChatStore((s) => s.sending)
  const sendingRef = useRef(sending)
  sendingRef.current = sending

  const collapse = (): void => {
    if (!expandedRef.current) return
    expandedRef.current = false
    window.lovelybuddy.collapseWindow('chat')
    window.lovelybuddy.setPassthrough(true) // 立即恢复穿透，交给 usePassthrough 状态机接管
  }

  const openPanel = (): void => {
    const token = ++tokenRef.current
    void window.lovelybuddy.expandWindow('chat', 0, CHAT_H).then(() => {
      expandedRef.current = true
      if (token !== tokenRef.current) return // 期间已关闭/重开
      setOpen(true)
    })
  }

  const closePanel = (): void => {
    tokenRef.current++
    setOpen(false)
    if (!sendingRef.current) collapse() // 流式中保持扩展（气泡）
  }

  // 流式结束而面板已关：自动缩回
  useEffect(() => {
    if (sending || open) return
    collapse()
  }, [sending, open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Element && e.target.closest('[data-interactive]')) return
      closePanel()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePanel()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return { open, openPanel, closePanel }
}
```

注意初始 effect（`if (sending || open) return; collapse()`）在挂载时也会跑一次：`expandedRef=false` 时 collapse 是 no-op，无害。

- [ ] **Step 4: 写失败测试（ChatPanel）**

Create `apps/desktop/src/renderer/src/pet/chat/__test__/ChatPanel.test.tsx`：

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from '../ChatPanel'
import { useChatStore } from '../../../store/chatStore'
import { usePetStore } from '../../../store/petStore'

const sendMock = vi.fn()
const stopMock = vi.fn()

describe('ChatPanel', () => {
  beforeEach(() => {
    sendMock.mockReset()
    stopMock.mockReset()
    useChatStore.setState({ items: [], sending: false, error: null, send: sendMock, stop: stopMock })
    usePetStore.setState({
      models: [
        { slug: 'haru', name: 'haru', url: 'l2d://model/haru/x.model3.json', kind: 'moc3', entry: 'haru/x.model3.json' } // AvatarInfo 要求 entry
      ],
      modelUrl: 'l2d://model/haru/x.model3.json',
      modelName: 'haru'
    })
  })
  afterEach(() => {
    cleanup() // vitest 不开 globals 时 testing-library 不会自动 cleanup，不清理会导致「多个元素」误报
    vi.restoreAllMocks()
  })

  it('渲染历史与空态提示', () => {
    useChatStore.setState({
      items: [
        { role: 'user', content: '嗨' },
        { role: 'assistant', content: '你好呀', motion: 'happy' }
      ]
    })
    render(<ChatPanel onClose={() => {}} />)
    expect(screen.getByText('嗨')).toBeTruthy()
    expect(screen.getByText('你好呀')).toBeTruthy()
  })

  it('Enter 发送（带当前形象 slug），输入框清空；IME 组词中的 Enter 不发送', () => {
    render(<ChatPanel onClose={() => {}} />)
    const input = screen.getByPlaceholderText('按 Enter 发送') as HTMLInputElement
    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true } as EventInit)
    expect(sendMock).not.toHaveBeenCalled() // 组词中
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sendMock).toHaveBeenCalledWith('你好', 'haru')
    expect(input.value).toBe('')
  })

  it('流式中显示停止按钮并调用 stop', () => {
    useChatStore.setState({ sending: true })
    render(<ChatPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(stopMock).toHaveBeenCalled()
  })

  it('错误信息展示', () => {
    useChatStore.setState({ error: '未配置 API key' })
    render(<ChatPanel onClose={() => {}} />)
    expect(screen.getByText('未配置 API key')).toBeTruthy()
  })
})
```

（jsdom 的 KeyboardEvent init 支持 `isComposing`；若所用 jsdom 版本不认，改为在 input 上派发原生 `new KeyboardEvent('keydown', { isComposing: true })` 并 `input.dispatchEvent`。）

`PetMenu.test.tsx`：既有用例的 `render(<PetMenu …>)` 全部补 `onChat={() => {}}`（新 prop 必填，typecheck 会拦）。

- [ ] **Step 5: 写实现（ChatPanel）**

Create `apps/desktop/src/renderer/src/pet/chat/ChatPanel.tsx`：

```tsx
import { useRef, type KeyboardEvent, type ReactElement } from 'react'
import { useChatStore } from '../../store/chatStore'
import { usePetStore } from '../../store/petStore'

interface Props {
  onClose: () => void
}

/** 聊天面板（窗口 chat 扩展区）：最近对话 + 输入框。data-interactive 保证穿透状态机可点。 */
export default function ChatPanel({ onClose }: Props): ReactElement {
  const items = useChatStore((s) => s.items)
  const sending = useChatStore((s) => s.sending)
  const error = useChatStore((s) => s.error)
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const inputRef = useRef<HTMLInputElement>(null)

  const currentSlug = (): string | undefined => {
    const { models, modelUrl } = usePetStore.getState()
    return models.find((m) => m.url === modelUrl)?.slug
  }

  const submit = (): void => {
    const input = inputRef.current
    if (!input) return
    const v = input.value.trim()
    if (!v) return
    input.value = ''
    void send(v, currentSlug())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
  }

  return (
    <div className="chat-panel" data-interactive onContextMenu={(e) => e.preventDefault()}>
      <div className="chat-head">
        <span>聊天</span>
        <button type="button" className="chat-close" title="收起" aria-label="收起" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="chat-messages">
        {items.length === 0 && <p className="chat-empty">和 AI桌宠 说点什么吧～</p>}
        {items.map((it, i) => (
          <div key={i} className={`chat-msg ${it.role}`}>
            {it.content}
          </div>
        ))}
        {error !== null && <div className="chat-error">{error}</div>}
      </div>
      <div className="chat-input-row">
        <input ref={inputRef} autoFocus data-interactive placeholder={sending ? '回复中…' : '按 Enter 发送'} onKeyDown={onKeyDown} />
        {sending ? (
          <button type="button" className="chat-stop" onClick={stop}>
            停止
          </button>
        ) : (
          <button type="button" className="chat-send" onClick={submit}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}
```

`styles/index.css` 追加（沿用 `.pet-menu` 的暗色毛玻璃语言）：

```css
/* ===== 聊天面板（chat 扩展区，靠窗口顶部）===== */
.chat-panel {
  position: fixed;
  z-index: 90;
  top: 8px;
  left: 8px;
  right: 8px;
  height: 224px; /* CHAT_H 240 - 上下留白 */
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 14px;
  background: rgba(30, 30, 46, 0.92);
  color: #eee;
  font-size: 12px;
  user-select: none;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #999;
}

.chat-close {
  border: none;
  background: transparent;
  color: #999;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.chat-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  user-select: text;
}

.chat-empty {
  color: #777;
  text-align: center;
  margin-top: 40px;
}

.chat-msg {
  max-width: 85%;
  padding: 6px 10px;
  border-radius: 10px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-msg.user {
  align-self: flex-end;
  background: #4a6cf7;
  color: #fff;
}

.chat-msg.assistant {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.08);
}

.chat-error {
  color: #ff8080;
  font-size: 11px;
}

.chat-input-row {
  display: flex;
  gap: 6px;
}

.chat-input-row input {
  flex: 1;
  padding: 6px 10px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: #eee;
  font-size: 12px;
  outline: none;
}

.chat-input-row input:focus {
  background: rgba(255, 255, 255, 0.16);
}

.chat-input-row button {
  padding: 6px 12px;
  border: none;
  border-radius: 8px;
  background: #4a6cf7;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

.chat-input-row .chat-stop {
  background: rgba(255, 255, 255, 0.12);
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/chat/__test__/`
Expected: PASS

- [ ] **Step 7: 集成（PetCanvas / PetMenu / App）+ PetMenu 测试**

`PetMenu.test.tsx` 追加用例（先跑确认失败——`onChat` prop 尚不存在，tsx 编译期即红）：

```tsx
it('聊天按钮触发 onChat 并关闭菜单', () => {
  const onChat = vi.fn()
  render(<PetMenu x={4} y={4} onClose={() => {}} onChat={onChat} />)
  fireEvent.click(screen.getByRole('button', { name: '聊天' }))
  expect(onChat).toHaveBeenCalled()
})
```

`PetMenu.tsx`：Props 增 `onChat: () => void`；`menu-actions` 区块改为：

```tsx
      <div className="menu-actions">
        <button onClick={onChat}>聊天</button>
        <button onClick={() => setImportOpen(!importOpen)}>{importOpen ? '收起' : '导入形象'}</button>
        {modelUrl !== null && (
          <button className="danger" onClick={confirmDelete}>
            删除当前形象
          </button>
        )}
      </div>
```

`PetCanvas.tsx`：Props 增 `chatOpen: boolean`（注释同 menuOpen：穿透状态机感知）；组件内两处：

```tsx
  usePassthrough(pet, menuOpen || chatOpen)
```

以及注册模型总线（放在 `const [pet, setPet] = useState…` 之后的 effect，或直接在 setPet 的 effect 里）：

```tsx
  // 模型实例登记到总线（气泡播放动作用）；卸载/切换时清空
  useEffect(() => {
    setActiveModel(pet)
    return () => {
      if (getActiveModel() === pet) setActiveModel(null)
    }
  }, [pet])
```

（import 增 `import { getActiveModel, setActiveModel } from '../live2d/modelBus'`。）

`App.tsx`：

```tsx
import ChatPanel from './pet/chat/ChatPanel'
import { useChatPanel } from './pet/chat/useChatPanel'
```

组件体内：

```tsx
  const { open: chatOpen, openPanel, closePanel } = useChatPanel()
```

JSX（PetCanvas 加 chatOpen；菜单传 onChat；面板条件渲染）：

```tsx
      <PetCanvas
        url={modelUrl}
        name={modelName ?? ''}
        menuOpen={menu !== null}
        chatOpen={chatOpen}
        onMenu={() => {
          if (menu) closeMenu()
          else openMenu()
        }}
      />
      {chatOpen && <ChatPanel onClose={closePanel} />}
      {menu !== null && (
        <PetMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          onChat={() => {
            closeMenu()
            openPanel()
          }}
        />
      )}
```

（原 PetMenu 渲染行按上面结构改写——原文件里它是单行 `{menu !== null && <PetMenu x={menu.x} y={menu.y} onClose={closeMenu} />}`。）

- [ ] **Step 8: 跑全量前端测试 + typecheck**

Run: `cd apps/desktop && pnpm vitest run && pnpm typecheck`
Expected: PASS（含既有 usePassthrough / PetMenu / menuLayout 用例）

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(desktop): 聊天面板与菜单入口、模型总线"
```

---

### Task 14: 打字机气泡（useTypewriter + SpeechBubble + 动作触发）

**Files:**
- Create: `apps/desktop/src/renderer/src/pet/chat/useTypewriter.ts`
- Create: `apps/desktop/src/renderer/src/pet/chat/SpeechBubble.tsx`
- Create: `apps/desktop/src/renderer/src/pet/chat/__test__/useTypewriter.test.ts`
- Create: `apps/desktop/src/renderer/src/pet/chat/__test__/SpeechBubble.test.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`（挂 SpeechBubble）
- Modify: `apps/desktop/src/renderer/src/styles/index.css`（气泡样式）

**Interfaces:**
- Consumes: `useChatStore`（Task 12）、`getActiveModel`（Task 13 modelBus）、`MotionIntent`/`INTENT_MOTIONS`（`live2d/motionMap.ts`）
- Produces: `useTypewriter(target: string): string`（40 字/秒追赶目标文本）；`<SpeechBubble panelOpen={boolean} />`（Task 15 消费 panelOpen = chatOpen）；`TYPE_CPS = 40`

- [ ] **Step 1: 写失败测试（useTypewriter）**

Create `apps/desktop/src/renderer/src/pet/chat/__test__/useTypewriter.test.ts`：

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTypewriter } from '../useTypewriter'

describe('useTypewriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('按 40 字/秒推进（30ms 一 tick，每 tick ≥1 字）', () => {
    const { result } = renderHook(({ t }) => useTypewriter(t), { initialProps: { t: 'abcde' } })
    expect(result.current).toBe('')
    act(() => {
      vi.advanceTimersByTime(120) // 4 tick × 1 字（cps*0.03=1.2 → round=1）
    })
    expect(result.current).toBe('abcd')
    act(() => {
      vi.advanceTimersByTime(30)
    })
    expect(result.current).toBe('abcde') // 追平后停住
  })

  it('目标增长（流式追加）继续追赶', () => {
    const { result, rerender } = renderHook(({ t }) => useTypewriter(t), { initialProps: { t: 'ab' } })
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(result.current).toBe('ab')
    rerender({ t: 'abcdef' })
    act(() => {
      vi.advanceTimersByTime(150) // 5 tick 追平 4 字
    })
    expect(result.current).toBe('abcdef')
  })

  it('目标清空即复位', () => {
    const { result, rerender } = renderHook(({ t }) => useTypewriter(t), { initialProps: { t: 'abc' } })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current).toBe('abc')
    rerender({ t: '' })
    expect(result.current).toBe('')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/chat/__test__/useTypewriter.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

Create `apps/desktop/src/renderer/src/pet/chat/useTypewriter.ts`：

```ts
import { useEffect, useState } from 'react'

/** 打字机速度（字/秒）——流式输出通常快于 40cps，气泡靠它平滑 */
export const TYPE_CPS = 40

const TICK_MS = 30

/**
 * 打字机：目标文本增长时按固定字速追赶（流式追加期间平滑显示），追平停住。
 * target 置空立即复位（气泡隐藏/换条时）。
 */
export function useTypewriter(target: string): string {
  const [shown, setShown] = useState('')

  useEffect(() => {
    if (target === '') {
      setShown('')
      return
    }
    const id = window.setInterval(() => {
      setShown((prev) => {
        if (prev.length >= target.length) return prev
        const advance = Math.max(1, Math.round((TYPE_CPS * TICK_MS) / 1000))
        return target.slice(0, Math.min(target.length, prev.length + advance))
      })
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [target])

  return shown
}
```

（实现细节：interval 依赖 target 引用变化而重建；流式期间 target 每变一次就重开 interval，tick 内用函数式 setState 从当前长度继续追——不会因重建而重置已显示长度。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/chat/__test__/useTypewriter.test.ts`
Expected: PASS

- [ ] **Step 5: 写失败测试（SpeechBubble）**

Create `apps/desktop/src/renderer/src/pet/chat/__test__/SpeechBubble.test.tsx`：

```tsx
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SpeechBubble from '../SpeechBubble'
import { useChatStore } from '../../../store/chatStore'
import { setActiveModel } from '../../../live2d/modelBus'
import type { PetModel } from '../../../live2d/model'
import type { MotionIntent } from '../../../live2d/motionMap'

const playIntent = vi.fn()
const fakePet = { playIntent } as unknown as PetModel

describe('SpeechBubble', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    playIntent.mockReset().mockResolvedValue(true)
    setActiveModel(fakePet)
    useChatStore.setState({ items: [], sending: false, error: null, lastMotion: null })
  })
  afterEach(() => {
    vi.useRealTimers()
    setActiveModel(null)
  })

  it('无回复 / 面板打开时不渲染', () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好' }] })
    const { container, rerender } = render(<SpeechBubble panelOpen={false} />)
    // 有回复但流式已结束且超过 8s → 隐藏（初始挂载即显示，推进 8s 后隐藏）
    act(() => {
      vi.advanceTimersByTime(8100)
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
    rerender(<SpeechBubble panelOpen={true} />)
    // 面板打开：最近回复变化也不显示
    useChatStore.setState({ items: [{ role: 'assistant', content: '新回复' }] })
    expect(container.querySelector('.speech-bubble')).toBeNull()
  })

  it('流式中显示打字机文本，8s 静默后隐藏', async () => {
    useChatStore.setState({ items: [{ role: 'assistant', content: '你好呀，我在' }], sending: true })
    const { container } = render(<SpeechBubble panelOpen={false} />)
    expect(container.querySelector('.speech-bubble')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(200) // 打字机推进
    })
    expect(container.querySelector('.speech-bubble')!.textContent).toContain('你')
    act(() => {
      useChatStore.setState({ sending: false }) // 流式结束，effect 在 act 末才注册 8s 计时
    })
    act(() => {
      vi.advanceTimersByTime(8100) // 与 setState 拆开：同一 act 里时钟先推进完、effect 还没注册计时器
    })
    expect(container.querySelector('.speech-bubble')).toBeNull()
  })

  it('motion 事件驱动当前模型播动作', () => {
    useChatStore.setState({
      items: [{ role: 'assistant', content: '哈' }],
      sending: true,
      lastMotion: { intent: 'happy', seq: 1 }
    })
    render(<SpeechBubble panelOpen={false} />)
    expect(playIntent).toHaveBeenCalledWith('happy')
  })

  it('非法意图不触发动作', () => {
    useChatStore.setState({
      items: [{ role: 'assistant', content: '哈' }],
      sending: true,
      lastMotion: { intent: 'dance', seq: 2 }
    })
    render(<SpeechBubble panelOpen={false} />)
    expect(playIntent).not.toHaveBeenCalled()
  })
})
```

（`playIntent` 假实现返回 Promise；`PetModel` 用 `as unknown as` 断言即可，测试只用 playIntent。）

- [ ] **Step 6: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/chat/__test__/SpeechBubble.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 7: 写实现**

Create `apps/desktop/src/renderer/src/pet/chat/SpeechBubble.tsx`：

```tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '../../store/chatStore'
import { getActiveModel } from '../../live2d/modelBus'
import { INTENT_MOTIONS, type MotionIntent } from '../../live2d/motionMap'
import { useTypewriter } from './useTypewriter'

/** 流式结束（sending=false）后静默多久淡出 */
const HIDE_AFTER_MS = 8000

interface Props {
  /** 聊天面板打开时让位（回复显示在面板历史里），气泡隐藏 */
  panelOpen: boolean
}

/**
 * 打字机气泡：流式/最近回复悬浮在 chat 扩展区顶部。纯展示（pointer-events:none，
 * 不加 data-interactive、不参与穿透状态机——点击应穿到桌面）。
 * store 的 motion 事件在此驱动模型播动作（服务端已剥离标签，本地只按意图播放）。
 */
export default function SpeechBubble({ panelOpen }: Props): ReactElement | null {
  const items = useChatStore((s) => s.items)
  const sending = useChatStore((s) => s.sending)
  const lastMotion = useChatStore((s) => s.lastMotion)
  const [visible, setVisible] = useState(false)

  const last = items.length > 0 ? items[items.length - 1] : null
  const isReply = last !== null && last.role === 'assistant' && last.content !== ''
  const shown = useTypewriter(visible && !panelOpen && isReply ? last.content : '')

  // 回复内容变化（新流式/新消息）→ 显示；面板打开 → 隐藏；静默 8s → 隐藏
  useEffect(() => {
    if (panelOpen || !isReply) {
      setVisible(false)
      return
    }
    setVisible(true)
    if (sending) return // 流式中不计时；sending 翻 false 会重跑本 effect 起计时
    const id = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS)
    return () => window.clearTimeout(id)
  }, [panelOpen, isReply, sending, last?.content])

  // motion 事件 → 当前模型播动作（seq 去重，一次事件一个动作）
  const seqRef = useRef(0)
  useEffect(() => {
    if (lastMotion === null || lastMotion.seq === seqRef.current) return
    seqRef.current = lastMotion.seq
    if (lastMotion.intent in INTENT_MOTIONS) {
      void getActiveModel()?.playIntent(lastMotion.intent as MotionIntent)
    }
  }, [lastMotion])

  if (!visible || panelOpen || !isReply) return null
  return (
    <div className="speech-bubble" aria-live="polite">
      {shown}
    </div>
  )
}
```

（打字机文本取 `last.content`，气泡内容追平即与面板/入库一致。）

`styles/index.css` 追加：

```css
/* ===== 打字机气泡（chat 扩展区顶部，纯展示不吞鼠标）===== */
.speech-bubble {
  position: fixed;
  z-index: 80;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 85%;
  max-height: 150px;
  overflow-y: auto;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(30, 30, 46, 0.92);
  color: #eee;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  pointer-events: none;
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}

.speech-bubble::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: rgba(30, 30, 46, 0.92);
  border-bottom: none;
}
```

`App.tsx` 挂载（ChatPanel 之后）：

```tsx
import SpeechBubble from './pet/chat/SpeechBubble'
```

```tsx
      <SpeechBubble panelOpen={chatOpen} />
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/chat/ && pnpm typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(desktop): 打字机气泡与动作触发"
```

---

### Task 15: 断线恢复 + 文档 + M2 冒烟验收

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`（启动拉历史 + offline→online 过渡刷新）
- Modify: `.env.example`（对话配置项注释）
- Modify: `docs/development.md`（M2 聊天联调段）

**Interfaces:**
- Consumes: `useChatStore.refresh`（Task 12）、`usePetStore.status`（已有健康轮询）
- Produces: 断线恢复行为（验收「重启历史完整」的前端半边）

- [ ] **Step 1: 在 App.tsx 接入（两段小逻辑，typecheck + 既有测试护航）**

组件体内（健康轮询 effect 之后）：

```tsx
  // 启动即拉一次历史（后端未起也不报错，等恢复后过渡刷新兜底）
  useEffect(() => {
    void useChatStore.getState().refresh()
  }, [])

  // 断线恢复：offline → online 时对齐历史（服务端可能落了半截/新消息）
  const status = usePetStore((s) => s.status)
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current === 'offline' && status === 'online') {
      void useChatStore.getState().refresh()
    }
    prevStatusRef.current = status
  }, [status])
```

（import 补 `useRef`、`useChatStore`。）

- [ ] **Step 2: 跑全量测试**

Run: `make test`
Expected: Go vet/test + typecheck + vitest 全绿（DB 未启动时 dao 集成测试 SKIP）

- [ ] **Step 3: 更新文档**

`.env.example` 在「模型 API Key」区块下追加：

```
# ===== 对话模型（M2）=====
# 厂商：deepseek（默认）| dashscope；不填走默认
# LOVELYBUDDY_CHAT_PROVIDER=deepseek
# 模型：不填用厂商默认（deepseek-chat / qwen-plus）
# LOVELYBUDDY_CHAT_MODEL=deepseek-chat
# 自定义 OpenAI 兼容端点（如本地 vLLM），不填用厂商默认地址
# LOVELYBUDDY_CHAT_BASE_URL=
```

`docs/development.md` 追加小节（放在现有调试内容之后）：

```markdown
## 聊天联调（M2）

1. `.env` 填 `DEEPSEEK_API_KEY=...`（或 `LOVELYBUDDY_CHAT_PROVIDER=dashscope` + `DASHSCOPE_API_KEY`），`make dev` 重启。
2. 右键桌宠 → 「聊天」→ 输入消息，回车发送；回复以打字机气泡出现在角色上方。
3. 冒烟 SSE（不经 UI）：

   ```bash
   curl -sN -H "Authorization: Bearer dev" -H "Content-Type: application/json" \
     -d '{"message":"打个招呼"}' http://127.0.0.1:8740/api/v1/chat
   curl -s -H "Authorization: Bearer dev" 'http://127.0.0.1:8740/api/v1/history?limit=5'
   ```

4. 未配 key 时发送会收到「未配置 API key」错误提示，属预期。
```

- [ ] **Step 4: 手工冒烟（M2 验收，对照 spec §7）**

Run: `memory_pressure -Q` 确认内存宽裕后 `make dev`，逐项确认：

1. 右键 → 聊天 → 输入「你叫什么」→ 回复**流式打字机**显示、无卡顿（验收①）
2. 回复含 `[motion:happy]` 时：模型播 happy 动作、气泡/面板/`curl history` 的 content 均无标签残留（验收②）
3. 回复中途点「停止」→ 半截内容保留显示；`curl history` 里有这条半截 assistant
4. 重启 `make dev`（Go 重启、Electron 重启各一次）→ 打开聊天面板，历史完整（验收③）；流式中 kill Go 进程 → 桌宠状态变「后端离线」、错误不弹崩 → Go 恢复后（air 自动拉起）状态回在线，历史自动刷新对齐
5. 菜单与聊天共存：流式期间右键开菜单再关 → 气泡区不被裁掉；全部关闭后窗口缩回模型尺寸

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/development.md apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): 断线恢复历史刷新与 M2 文档"
```

---

## 验收对照（spec §7 M2）

| 验收 | 覆盖 |
|---|---|
| 流式不卡顿 | 每事件 flush（Task 9）+ 打字机 40cps 平滑（Task 14）+ 冒烟 ① |
| 库里 content 干净 | MotionFilter 剥离后入库（Task 5/8）+ 冒烟 ② |
| 重启历史完整 | messages 表 + `/api/v1/history` + 启动/断线恢复 refresh（Task 4/9/15）+ 冒烟 ④ |

spec §4 摘要逐项：Provider 抽象 ✓（Task 3）；openaiCompat 唯一实现 + 注册表 ✓；DeepSeek 默认 ✓（Task 3）；prompt 顺序 稳定前缀→历史→最新输入 ✓（Task 6，检索记忆位留 M5）；每形象人格 ✓（Task 6 PersonaText + Task 8 注入）；分层解耦（用户要求）✓（Task 1 dao/service/controller/router，server.go 只组装）；EmbeddingProvider/记忆 → M5，不在本计划。

## 执行注意

- 任务顺序即依赖顺序（1→15），Go 侧 1-9（Task 1 是解耦重构，先于一切新代码）、Electron 侧 10-15；10 是 11-15 的前置。
- Task 4 的 dao 集成测试需要 `make db`（pgvector）；未起库自动 SKIP，不阻塞。
- Task 9 Step 5 与 Task 15 Step 4 的手工冒烟需要 `.env` 里的真实 API key。







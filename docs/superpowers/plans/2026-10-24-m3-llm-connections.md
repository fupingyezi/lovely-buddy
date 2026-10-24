# M3 模型与连接（LLM API 设置）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 ardot 设计文件「06 模型与连接」节点实装设置页的 LLM 连接管理：连接列表 + 当前模型卡 + 新增/编辑表单 + 测试连接 + 保存并启用，对话 API 由界面注入（服务端 JSON 配置接管，env/.env 降为未配置时的兜底），厂商热切换免重启。

**Architecture:** Go 新增 `internal/configstore`（JSON 文件 0600 原子写，API Key 明文只存本机文件、出参只给掩码）+ `llm.Registry`（当前厂商的并发安全持有者，保存/启用后 Swap 生效，进行中的流在发起时捕获实例不受切换影响）+ `service.ConfigService`（校验/编排/连通测试文案化）+ `/api/v1/config` 五端点；`ChatService` 改持 Registry，每次对话开头取当前厂商。前端新增 `lib/configApi.ts` + `store/connectionStore.ts` + `pet/settings/ConnectionPage.tsx`（当前卡/行列表三态/表单双模式），`SettingsPanel` 启用「模型与连接」导航。

**Tech Stack:** Go + gin（新增无外部依赖：crypto/rand、net/url、os.UserConfigDir）；React 18 + zustand + Tailwind v4（无新依赖）。

**Spec:** ardot 设计文件「可爱清新视觉方案 v0.1」节点 `06 模型与连接`（`cocraft://localhost/file/739813504834201`，本计划已提取全部实测值，执行时以本计划为准、不重复读图）；`docs/design-v1/README.md` §06（v1 设计图 06-connection.png 的交互转写）；`docs/design.md` §4 模型对接 + M3 里程碑（「/api/config、厂商切换、key 写 .env、连通测试」——key 落盘方式按用户决策改为界面注入的 JSON 配置，见关键决策 1）。

## 关键决策（设计图/README 未细化处的裁定）

1. **「对话 API 由界面注入，而非环境注入」（用户明确指令，最高优先级）**：新增 `configstore` JSON 文件（默认 `os.UserConfigDir()/lovelybuddy/config.json`，`LOVELYBUDDY_CONFIG_FILE` 可覆盖；0600 + 临时文件 rename 原子写）。**存在已保存连接时**：服务端启动用激活连接、运行期由 `/api/v1/config` 全量接管，env/.env 不参与。**没有任何已保存连接时**：env/.env 仍是兜底默认来源（`config.Load()` + `llm.Resolve` 现有路径不动，保证 `make dev` 与 M2 回归不受影响）。设计图页脚「密钥存于本机 keychain」与本裁定冲突：keychain 无法被独立 Go 进程读取，落 0600 本机文件是单用户 macOS 桌面的等价实现，页脚文案照设计图原样保留。
2. **连接数据模型**：一条连接 = 服务商 + Base URL + 模型名 + 最大 Token + API Key，全包一体（README「当前模型卡实时更新，旧连接自动降为未使用」）。连接只有「保存并启用」一个激活入口；行点击 = 打开**编辑表单**（设计图表单内 API Key 掩码 +「已保存」tag 只能出现在编辑既有连接时），编辑保存同样激活该连接。
3. **API Key 永不出参**：GET 只回 `key_masked`（前 3 + 16 个 • + 后 4，设计图实测 16 个 •）+ `has_key`。编辑模式下用户未动 key 字段 → 请求体 `api_key` 为空 = 保留原 key；聚焦输入 = 整体替换（README「聚焦时才可整体替换」）。
4. **三态判定**（对齐设计图三行形态）：`last_check`（最近一次测试成功时间）非空 → 已连接（绿点「已连接」/ 行 meta「N 分钟前校验通过」）；`check_fail`（最近一次测试失败）→ 灰点「未连接」+ meta「服务未启动」；两者皆无 → 从未测试（行「未使用」+ meta「密钥已保存」，当前卡「尚未校验」）。测试连接本身不落盘，保存时经 `tested/test_ok` 字段落盘结果（README「失败浮红字并保留输入」）。
5. **服务商下拉四个内置厂商**（spec §4：DeepSeek/GLM/Qwen/Kimi）：`deepseek` / `dashscope`（阿里云百炼，Qwen）/ `zhipu`（智谱 GLM）/ `moonshot`（月之暗面 Kimi）。任意 OpenAI 兼容端点（含本地 Ollama/vLLM）经 Base URL 覆盖：http 仅允许 127.0.0.1/localhost/::1（设计图「本地 Ollama · 127.0.0.1:11434」行）。
6. **「切换连接时若正在流式生成，等当前回复结束再切」由服务端天然满足**：`ChatService.Stream` 在开头捕获 `reg.Current()` 实例，Swap 只影响下一次对话——不写任何前端等待逻辑。
7. **设计图未画的 active 行**：按 token 规则推演为「使用中」薄荷胶囊（selected-bg 底 + primary-deep 字，与形象管理页一致）；当前模型卡「已连接」态沿用卡内 Status（绿点 + active-ink 文字）。
8. **测试连接 = 真实 1-token 补全**（`MaxTokens: 1`，消息 `hi`），10 秒超时；上游错误归类为可读中文文案（401→「API Key 无效（401）」等），不裸透传。
9. **保存不要求连通性**：格式合法即可落盘（对齐设计图「未连接带灰点」行——允许保存未验证/失败的连接）。

## Global Constraints

- 产品显示名 **AI桌宠**；用户可见文案禁角色名；测试夹具用中性素材名（haru/shizuku）；console 前缀 `[lovely-buddy]`
- 后端分层单向：dao ← service ← controller ← router（configstore 视为 dao 层持久化）；新端点照既有模式落位
- API 错误统一 `{error: "中文文案"}`；校验失败 422 且**绝不落盘**（M3「非法配置拒绝不落盘」）；未知 id 404
- API Key 只存 configstore 文件（0600），HTTP 出参/日志/错误文案一律不携带明文
- 前端测试放功能目录 `__test__/`（vitest + jsdom + @testing-library/react）；Go 测试与源码同目录 `*_test.go`，不触真实网络（连通测试用 httptest 假端点）
- 样式：JSX 只写工具类；token 引用 `bg-primary`、`text-(--fs-body)`、`gap-(--sp-1)`；token 没有的值用任意值（图内 9px 字号、#f2fcf7 卡底、#bfe5d9 描边、#70d9b8→#36a382 渐变、#4cc29a 状态点、#dcd5cb 灰点、#d6e5de 添加按钮描边、#f2efe6/#f0f5f2 logo 底、#8fa5a0 首字母、#2e5e50 卡连接名、#e6ded1 测试按钮描边）；语义类只留测试锚点（`connection-row`/`connection-card`/`connection-form`）
- Commit：Conventional Commits、subject 小写开头，直接提交 main
- `make test` 全绿（Go vet/test + typecheck + vitest）为每个 Task 的硬门槛

## 文件结构总览

```
server/internal/configstore/         configstore.go（新建）    JSON 持久化 + 掩码 + 增删激活
                                     configstore_test.go（新建）
server/internal/llm/                 provider.go               registry 表 + zhipu/moonshot
                                     openai_compat.go          New() + maxTokens + Resolve 重构
                                     registry.go（新建）       当前厂商热切换持有者
                                     registry_test.go（新建）
server/internal/service/             config.go（新建）         ConfigService：校验/编排/测试连接
                                     config_test.go（新建）
server/internal/controller/          config.go（新建）         /api/v1/config 五端点
server/internal/router/router.go     config 路由注册
server/internal/server/server.go     New() 加 cfgSvc 参数
server/cmd/lovely-buddy-server/main.go  configstore 载入 + 激活连接优先 + 装配
server/internal/service/chat.go      ChatService 改持 Registry + 未配 key 文案
server/internal/service/chat_test.go     既有 6 处构造点改 llm.NewRegistry
server/internal/server/server_test.go    构造点改 Registry + cfgSvc
apps/desktop/src/renderer/src/lib/   configApi.ts（新建）      /api/v1/config 客户端
                                     __test__/configApi.test.ts（新建）
apps/desktop/src/renderer/src/store/ connectionStore.ts（新建） 配置状态 + 表单流程
                                     __test__/connectionStore.test.ts（新建）
apps/desktop/src/renderer/src/pet/settings/  ConnectionPage.tsx（新建）  当前卡/行列表/表单
                                     connectionFormat.ts（新建）  relTime/providerLabel/hostOf 纯函数
                                     __test__/connectionFormat.test.ts（新建）
                                     __test__/ConnectionPage.test.tsx（新建）
                                     SettingsPanel.tsx         启用「模型与连接」页
                                     __test__/SettingsPanel.test.tsx  导航断言更新
                                     SettingsApp.tsx           挂载加载 config
CLAUDE.md                            设置面板段更新（模型与连接已实装）
```

---

### Task 1: configstore —— 连接配置持久化（JSON 0600 + 掩码 + 增删激活）

**Files:**
- Create: `server/internal/configstore/configstore.go`
- Test: `server/internal/configstore/configstore_test.go`

**Interfaces:**
- Consumes: 无（纯持久化层）
- Produces: `type Connection struct { ID, Provider, BaseURL, Model string; MaxTokens int; APIKey string; LastCheck *time.Time; CheckFail bool }`、`type File struct { ActiveID string; Connections []Connection }`、`Load() (*File, error)`、`(f *File) Save() error`、`MaskKey(key string) string`、`(f *File) Add(c Connection) *Connection`、`(f *File) Remove(id string) bool`、`(f *File) SetActive(id string) bool`、`(f *File) Active() *Connection`、`(f *File) Find(id string) *Connection`——Task 3/4 按这些签名使用

- [ ] **Step 1: 写测试（先红）**

Create `server/internal/configstore/configstore_test.go`：

```go
package configstore

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// tmpPath 把配置文件指到临时目录（测试隔离，不碰真实用户配置）。
func tmpPath(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("LOVELYBUDDY_CONFIG_FILE", p)
	return p
}

func TestLoadMissingFileReturnsEmpty(t *testing.T) {
	tmpPath(t)
	f, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(f.Connections) != 0 || f.ActiveID != "" {
		t.Fatalf("期望空配置，得 %+v", f)
	}
}

func TestSaveLoadRoundtripAndPerm(t *testing.T) {
	p := tmpPath(t)
	now := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	f := &File{ActiveID: "x"}
	c := f.Add(Connection{Provider: "deepseek", Model: "deepseek-chat", APIKey: "sk-1234abcd", LastCheck: &now, CheckFail: false})
	if c.ID == "" {
		t.Fatal("Add 应生成非空 ID")
	}
	f.ActiveID = c.ID
	if err := f.Save(); err != nil {
		t.Fatalf("Save: %v", err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("期望 0600，得 %o", info.Mode().Perm())
	}
	got, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.ActiveID != c.ID || len(got.Connections) != 1 {
		t.Fatalf("roundtrip 不一致: %+v", got)
	}
	if got.Connections[0].APIKey != "sk-1234abcd" || !got.Connections[0].LastCheck.Equal(now) {
		t.Fatalf("字段丢失: %+v", got.Connections[0])
	}
}

func TestLoadCorruptedReturnsError(t *testing.T) {
	p := tmpPath(t)
	if err := os.WriteFile(p, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(); err == nil {
		t.Fatal("损坏 JSON 应报错")
	}
}

func TestMaskKey(t *testing.T) {
	cases := map[string]string{
		"sk-1234567890abcdef3f2a": "sk-" + "••••••••••••••••" + "3f2a",
		"short":                   "••••••••••••••••",
		"":                        "••••••••••••••••",
	}
	for in, want := range cases {
		if got := MaskKey(in); got != want {
			t.Errorf("MaskKey(%q) = %q, 期望 %q", in, got, want)
		}
	}
}

func TestRemoveActiveFallsBackToFirstRemaining(t *testing.T) {
	f := &File{}
	a := f.Add(Connection{Provider: "deepseek"})
	b := f.Add(Connection{Provider: "dashscope"})
	f.ActiveID = a.ID
	if !f.Remove(a.ID) {
		t.Fatal("Remove 应成功")
	}
	if f.ActiveID != b.ID {
		t.Fatalf("删除激活项应回退剩余第一条，得 %q", f.ActiveID)
	}
	if !f.Remove(b.ID) {
		t.Fatal("Remove 应成功")
	}
	if f.ActiveID != "" {
		t.Fatalf("删光后 active 应为空，得 %q", f.ActiveID)
	}
	if f.Remove("ghost") {
		t.Fatal("删除不存在 id 应返回 false")
	}
}

func TestSetActiveAndFind(t *testing.T) {
	f := &File{}
	c := f.Add(Connection{Provider: "zhipu", Model: "glm-4-flash"})
	if f.SetActive("ghost") {
		t.Fatal("未知 id 激活应返回 false")
	}
	if !f.SetActive(c.ID) || f.ActiveID != c.ID {
		t.Fatal("激活失败")
	}
	if got := f.Active(); got == nil || got.Model != "glm-4-flash" {
		t.Fatal("Active 应返回激活连接")
	}
	if got := f.Find(c.ID); got == nil || got.Provider != "zhipu" {
		t.Fatal("Find 应命中")
	}
	if f.Find("ghost") != nil {
		t.Fatal("Find 未知 id 应为 nil")
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/configstore/`
Expected: FAIL（package 不存在）

- [ ] **Step 3: 实现 configstore.go**

Create `server/internal/configstore/configstore.go`：

```go
// Package configstore 「模型与连接」配置的本地持久化（M3）：单一 JSON 文件（0600，原子写）。
// 对话 API 的 provider/model/key 由设置界面经 /api/v1/config 注入并接管（用户决策：
// 界面注入而非环境注入）；env/.env 仅在没有已保存连接时作为兜底默认来源。
// APIKey 明文只存在于本文件，任何 API 出参/日志/错误文案不得携带。
package configstore

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Connection 一条已保存的厂商连接。LastCheck 非空 = 最近一次测试连接成功；
// CheckFail = 最近一次测试失败；两者皆无 = 从未测试。
type Connection struct {
	ID        string     `json:"id"`
	Provider  string     `json:"provider"`   // llm.Providers 的键（deepseek/dashscope/zhipu/moonshot）
	BaseURL   string     `json:"base_url"`   // 空 = 厂商默认地址
	Model     string     `json:"model"`      // 空 = 厂商默认模型
	MaxTokens int        `json:"max_tokens"` // 0 = 不传（上游默认）
	APIKey    string     `json:"api_key"`
	LastCheck *time.Time `json:"last_check"`
	CheckFail bool       `json:"check_fail"`
}

// File 磁盘文件的内存态。读写都经 Save/Load。
type File struct {
	ActiveID    string       `json:"active_id"`
	Connections []Connection `json:"connections"`
}

// Path 配置文件路径：LOVELYBUDDY_CONFIG_FILE 优先，
// 默认 os.UserConfigDir()/lovelybuddy/config.json（macOS ~/Library/Application Support）。
func Path() string {
	if p := os.Getenv("LOVELYBUDDY_CONFIG_FILE"); p != "" {
		return p
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "lovelybuddy.config.json"
	}
	return filepath.Join(base, "lovelybuddy", "config.json")
}

// Load 读入配置。文件不存在 = 合法空配置（返回空 File）；
// JSON 损坏返回错误——调用方告警后用空 File 兜底、不覆盖原文件。
func Load() (*File, error) {
	raw, err := os.ReadFile(Path())
	if err != nil {
		if os.IsNotExist(err) {
			return &File{}, nil
		}
		return nil, err
	}
	f := &File{}
	if err := json.Unmarshal(raw, f); err != nil {
		return nil, fmt.Errorf("配置解析失败: %w", err)
	}
	return f, nil
}

// Save 原子写回（0600）：先写临时文件再 rename，写坏不破坏旧文件。
func (f *File) Save() error {
	path := Path()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// MaskKey 掩码：前 3 + 16 个 • + 后 4（设计图实测，如 sk-••••••••••••••••3f2a）；
// 长度 ≤ 8 全掩码。
func MaskKey(key string) string {
	if len(key) <= 8 {
		return "••••••••••••••••"
	}
	return key[:3] + "••••••••••••••••" + key[len(key)-4:]
}

// newID 8 位随机 hex 前缀 c（c3f2a91b）。
func newID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "c" + hex.EncodeToString(b)
}

// Add 追加连接（查重在 service 层做）并生成 ID，返回新连接指针。
func (f *File) Add(c Connection) *Connection {
	c.ID = newID()
	f.Connections = append(f.Connections, c)
	return &f.Connections[len(f.Connections)-1]
}

// Remove 删除连接；删掉激活项时回退到剩余第一条（无剩余则空）。
// 未知 id 返回 false。
func (f *File) Remove(id string) bool {
	for i, c := range f.Connections {
		if c.ID == id {
			f.Connections = append(f.Connections[:i], f.Connections[i+1:]...)
			if f.ActiveID == id {
				f.ActiveID = ""
				if len(f.Connections) > 0 {
					f.ActiveID = f.Connections[0].ID
				}
			}
			return true
		}
	}
	return false
}

// SetActive 切换激活连接；未知 id 返回 false。
func (f *File) SetActive(id string) bool {
	for _, c := range f.Connections {
		if c.ID == id {
			f.ActiveID = id
			return true
		}
	}
	return false
}

// Active 当前激活连接（无则 nil）。
func (f *File) Active() *Connection {
	return f.Find(f.ActiveID)
}

// Find 按 id 找连接（无则 nil）。
func (f *File) Find(id string) *Connection {
	for i := range f.Connections {
		if f.Connections[i].ID == id {
			return &f.Connections[i]
		}
	}
	return nil
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/configstore/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd server && go vet ./internal/configstore/
cd .. && git add server/internal/configstore/ && git commit -m "feat(configstore): 模型与连接配置持久化（JSON 0600 原子写 + key 掩码）"
```

---

### Task 2: llm —— Registry 热切换 + New() 显式注入 + 新厂商

**Files:**
- Modify: `server/internal/llm/provider.go`（registry 表 + zhipu/moonshot）
- Modify: `server/internal/llm/openai_compat.go`（New() + maxTokens + Resolve 重构）
- Create: `server/internal/llm/registry.go`
- Test: `server/internal/llm/registry_test.go`（新建）；`server/internal/llm/openai_compat_test.go`（如既有断言命中则更新）
- Modify: `.env.example`（新增 MOONSHOT_API_KEY 注释行）

**Interfaces:**
- Consumes: Task 1 无依赖；env 侧 `config.Load()` 不变
- Produces: `llm.Providers` 含 `zhipu`（默认 `glm-4-flash`、`ZHIPU_API_KEY`）、`moonshot`（默认 `moonshot-v1-8k`、`MOONSHOT_API_KEY`）；`llm.New(provider, model, baseURL, apiKey string, maxTokens int) (*OpenAICompat, error)`（key 显式传入、不读 env）；`llm.Resolve(provider, model, baseURLOverride string)`（env 路径，key 从厂商 APIKeyEnv 读）；`llm.NewRegistry(initial ChatProvider) *Registry`、`(r *Registry) Swap(p ChatProvider)`、`(r *Registry) Current() ChatProvider`——Task 3/4/7 按这些签名使用

- [ ] **Step 1: 写测试（先红）**

Create `server/internal/llm/registry_test.go`：

```go
package llm

import "testing"

type stubProvider struct{}

func (stubProvider) StreamChat(_ctx interface{ Done() <-chan struct{} }, _msgs []Message) <-chan StreamEvent {
	panic("not used")
}
```

```go
package llm

import "testing"

// 用真实 OpenAICompat 做 Swap 语义测试（无网络调用，只看持有者切换）。
func TestRegistrySwapAndCurrent(t *testing.T) {
	p1, err := New("deepseek", "", "", "k1", 0)
	if err != nil {
		t.Fatal(err)
	}
	p2, err := New("dashscope", "", "", "k2", 0)
	if err != nil {
		t.Fatal(err)
	}
	r := NewRegistry(p1)
	if r.Current() != p1 {
		t.Fatal("初始 current 应为 p1")
	}
	r.Swap(p2)
	if r.Current() != p2 {
		t.Fatal("Swap 后 current 应为 p2")
	}
}

// 发起时捕获的实例不受后续 Swap 影响（对齐设计「等当前回复结束再切」）。
func TestRegistryCapturedInstanceUnaffectedBySwap(t *testing.T) {
	p1, _ := New("deepseek", "", "", "k1", 0)
	p2, _ := New("dashscope", "", "", "k2", 0)
	r := NewRegistry(p1)
	captured := r.Current() // 对话发起时刻
	r.Swap(p2)
	if captured != p1 {
		t.Fatal("已捕获实例不应被 Swap 改变")
	}
}
```

`openai_compat_test.go` 追加（沿用既有文件 httptest 模式；若既有文件无 httptest 则建 `openai_compat_new_test.go`）：

```go
func TestNewExplicitKeyAndMaxTokens(t *testing.T) {
	var gotAuth, gotModel string
	var gotMax int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		var req map[string]any
		_ = json.Unmarshal(body, &req)
		gotModel, _ = req["model"].(string)
		if v, ok := req["max_tokens"].(float64); ok {
			gotMax = int(v)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n")
	}))
	defer srv.Close()

	p, err := New("moonshot", "moonshot-v1-8k", srv.URL, "sk-test-key", 512)
	if err != nil {
		t.Fatal(err)
	}
	if !p.Configured() || p.KeyEnv() != "MOONSHOT_API_KEY" {
		t.Fatalf("Configured/KeyEnv 异常: %v %v", p.Configured(), p.KeyEnv())
	}
	for ev := range p.StreamChat(context.Background(), []Message{{Role: "user", Content: "hi"}}) {
		if ev.Err != nil {
			t.Fatalf("流错误: %v", ev.Err)
		}
	}
	if gotAuth != "Bearer sk-test-key" {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	if gotModel != "moonshot-v1-8k" || gotMax != 512 {
		t.Fatalf("model=%q max_tokens=%d", gotModel, gotMax)
	}
}

func TestNewUnknownProviderErrors(t *testing.T) {
	if _, err := New("nope", "", "", "k", 0); err == nil {
		t.Fatal("未知厂商应报错")
	}
}

func TestNewDefaults(t *testing.T) {
	p, err := New("zhipu", "", "", "k", 0)
	if err != nil {
		t.Fatal(err)
	}
	if p.model != "glm-4-flash" {
		t.Fatalf("默认模型 = %q", p.model)
	}
}
```

imports 补齐：`context`、`encoding/json`、`fmt`、`io`、`net/http`、`net/http/httptest`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/llm/`
Expected: FAIL（New/NewRegistry 未定义）

- [ ] **Step 3: provider.go 扩表**

Modify `server/internal/llm/provider.go`，`Providers` 改为：

```go
// Providers 内置厂商（spec §4：DeepSeek/GLM/Qwen/Kimi，全部 OpenAI 兼容端点）。
var Providers = map[string]ProviderSpec{
	"deepseek":  {BaseURL: "https://api.deepseek.com", DefaultModel: "deepseek-chat", APIKeyEnv: "DEEPSEEK_API_KEY"},
	"dashscope": {BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", DefaultModel: "qwen-plus", APIKeyEnv: "DASHSCOPE_API_KEY"},
	"zhipu":     {BaseURL: "https://open.bigmodel.cn/api/paas/v4", DefaultModel: "glm-4-flash", APIKeyEnv: "ZHIPU_API_KEY"},
	"moonshot":  {BaseURL: "https://api.moonshot.cn/v1", DefaultModel: "moonshot-v1-8k", APIKeyEnv: "MOONSHOT_API_KEY"},
}
```

- [ ] **Step 4: openai_compat.go 重构（New + maxTokens + Resolve）**

Modify `server/internal/llm/openai_compat.go`：

```go
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
```

`StreamChat` 内建请求处加 maxTokens（原 `stream, err := p.client.CreateChatCompletionStream(ctx, openai.ChatCompletionRequest{...})` 改为）：

```go
	req := openai.ChatCompletionRequest{Model: p.model, Messages: om, Stream: true}
	if p.maxTokens > 0 {
		req.MaxTokens = p.maxTokens
	}
	stream, err := p.client.CreateChatCompletionStream(ctx, req)
```

删除旧 `Resolve` 原实现（被新 Resolve 替换）。既有 `Configured()`/`KeyEnv()`/`StreamChat` 其余部分不动。

- [ ] **Step 5: registry.go**

Create `server/internal/llm/registry.go`：

```go
package llm

import "sync"

// Registry 当前对话厂商的并发安全持有者。设置界面保存/启用连接后 Swap 立即生效；
// 进行中的对话在发起时捕获实例，不受切换影响（设计「等当前回复结束再切」）。
type Registry struct {
	mu  sync.RWMutex
	cur ChatProvider
}

// NewRegistry 以初始厂商建注册表（启动时的 env 兜底实例）。
func NewRegistry(initial ChatProvider) *Registry {
	return &Registry{cur: initial}
}

// Swap 原子替换当前厂商（只影响下一次对话）。
func (r *Registry) Swap(p ChatProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cur = p
}

// Current 取当前厂商；调用方捕获后使用，保证一次对话内厂商一致。
func (r *Registry) Current() ChatProvider {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.cur
}
```

- [ ] **Step 6: 既有断言检查 + .env.example**

Run: `grep -n "未知对话厂商" server/internal/llm/*_test.go`——如既有断言含旧文案（`可选: deepseek, dashscope`），更新为 `可选: deepseek, dashscope, zhipu, moonshot`（与 provider.go 新文案一致）。

Modify `.env.example`，`DASHSCOPE_API_KEY=` 行后加：

```
# 月之暗面 Kimi（备用对话）：https://platform.moonshot.cn
MOONSHOT_API_KEY=
```

- [ ] **Step 7: 跑测试确认通过**

Run: `cd server && go test ./internal/llm/`
Expected: PASS（含既有 openai_compat_test.go）

- [ ] **Step 8: Commit**

```bash
cd server && go vet ./internal/llm/
cd .. && git add server/internal/llm/ .env.example && git commit -m "feat(llm): 厂商注册表热切换 registry + 显式 key 注入 New() + zhipu/moonshot"
```

---

### Task 3: ConfigService —— 校验/编排/连通测试

**Files:**
- Create: `server/internal/service/config.go`
- Test: `server/internal/service/config_test.go`

**Interfaces:**
- Consumes: Task 1 `configstore.*`、Task 2 `llm.New/NewRegistry/Registry`
- Produces: `type ConnInput struct { Provider, BaseURL, Model, APIKey string; MaxTokens int; Tested, TestOK bool }`、`type TestInput struct { Provider, BaseURL, Model, APIKey string; MaxTokens int }`、`type ConnectionOut struct { ID, Provider, BaseURL, Model string; MaxTokens int; KeyMasked string; HasKey bool; LastCheck *time.Time; CheckFail bool; Active bool }`、`type ConfigState struct { ActiveID string; Connections []ConnectionOut }`、`type TestResult struct { OK bool; Error string; LatencyMS int64 }`、`NewConfigService(reg *llm.Registry, file *configstore.File, fallback llm.ChatProvider) *ConfigService`、`(s *ConfigService) State() ConfigState`、`Validate(in TestInput) error`、`Add(input ConnInput) (ConfigState, error)`（重复返回 `ErrDuplicate`）、`Update(id string, input ConnInput) (ConfigState, error)`（未知返回 `ErrNotFound`）、`Remove(id string) (ConfigState, error)`（未知返回 `ErrNotFound`）、`SetActive(id string) (ConfigState, error)`（未知返回 `ErrNotFound`）、`Test(input TestInput) TestResult`——Task 4 按这些签名使用

- [ ] **Step 1: 写测试（先红）**

Create `server/internal/service/config_test.go`：

```go
package service

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"lovelybuddy/server/internal/configstore"
	"lovelybuddy/server/internal/llm"
)

func newSvc(t *testing.T) (*ConfigService, *configstore.File) {
	t.Helper()
	t.Setenv("LOVELYBUDDY_CONFIG_FILE", filepath.Join(t.TempDir(), "config.json"))
	file, err := configstore.Load()
	if err != nil {
		t.Fatal(err)
	}
	fallback, err := llm.New("deepseek", "", "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	return NewConfigService(llm.NewRegistry(fallback), file, fallback), file
}

func validInput() ConnInput {
	return ConnInput{Provider: "deepseek", Model: "deepseek-chat", APIKey: "sk-abc", BaseURL: "", MaxTokens: 0}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name  string
		mut   func(*TestInput)
		bad   bool
	}{
		{"合法", func(*TestInput) {}, false},
		{"未知厂商", func(in *TestInput) { in.Provider = "nope" }, true},
		{"模型名空", func(in *TestInput) { in.Model = "  " }, true},
		{"BaseURL 非 http(s)", func(in *TestInput) { in.BaseURL = "ftp://x" }, true},
		{"BaseURL 远程 http 不允许", func(in *TestInput) { in.BaseURL = "http://example.com/v1" }, true},
		{"BaseURL 本地 http 允许", func(in *TestInput) { in.BaseURL = "http://127.0.0.1:11434/v1" }, false},
		{"MaxTokens 负数", func(in *TestInput) { in.MaxTokens = -1 }, true},
		{"MaxTokens 超上限", func(in *TestInput) { in.MaxTokens = 1000001 }, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			base := TestInput{Provider: "deepseek", Model: "m"}
			c.mut(&base)
			err := Validate(base)
			if (err != nil) != c.bad {
				t.Fatalf("Validate = %v, 期望 bad=%v", err, c.bad)
			}
		})
	}
}

func TestAddActivatesAndPersists(t *testing.T) {
	svc, file := newSvc(t)
	state, err := svc.Add(validInput())
	if err != nil {
		t.Fatal(err)
	}
	if state.ActiveID == "" || len(state.Connections) != 1 || !state.Connections[0].Active {
		t.Fatalf("新增应自动激活: %+v", state)
	}
	if state.Connections[0].APIKey != "" {
		t.Fatal("出参不得携带 key")
	}
	_ = state
	got, _ := configstore.Load()
	if got.ActiveID == "" || got.Connections[0].APIKey != "sk-abc" {
		t.Fatal("应已落盘且 key 明文存文件")
	}
	if file.ActiveID != got.ActiveID {
		t.Fatal("内存态与磁盘应一致")
	}
}

func TestAddDuplicate(t *testing.T) {
	svc, _ := newSvc(t)
	if _, err := svc.Add(validInput()); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Add(validInput()); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("重复应返回 ErrDuplicate，得 %v", err)
	}
}

func TestUpdateKeepsKeyWhenEmpty(t *testing.T) {
	svc, _ := newSvc(t)
	st, _ := svc.Add(validInput())
	id := st.ActiveID
	// key 留空 = 保留原 key（编辑表单未动 key 字段）
	st2, err := svc.Update(id, ConnInput{Provider: "deepseek", Model: "deepseek-reasoner", APIKey: "", MaxTokens: 100})
	if err != nil {
		t.Fatal(err)
	}
	if st2.Connections[0].Model != "deepseek-reasoner" || st2.Connections[0].MaxTokens != 100 {
		t.Fatalf("更新未生效: %+v", st2.Connections[0])
	}
	got, _ := configstore.Load()
	if got.Connections[0].APIKey != "sk-abc" {
		t.Fatal("空 key 应保留原 key")
	}
	// 显式传新 key = 整体替换
	if _, err := svc.Update(id, ConnInput{Provider: "deepseek", Model: "m", APIKey: "sk-new"}); err != nil {
		t.Fatal(err)
	}
	got, _ = configstore.Load()
	if got.Connections[0].APIKey != "sk-new" {
		t.Fatal("非空 key 应替换")
	}
	if _, err := svc.Update("ghost", validInput()); !errors.Is(err, ErrNotFound) {
		t.Fatal("未知 id 应返回 ErrNotFound")
	}
}

func TestRemoveAndSetActive(t *testing.T) {
	svc, _ := newSvc(t)
	svc.Add(validInput())
	st, _ := svc.Add(ConnInput{Provider: "dashscope", Model: "qwen-plus", APIKey: "k2"})
	second := st.Connections[1].ID
	if _, err := svc.Remove("ghost"); !errors.Is(err, ErrNotFound) {
		t.Fatal("未知 id 删除应返回 ErrNotFound")
	}
	if _, err := svc.SetActive(second); err != nil {
		t.Fatal(err)
	}
	st2, err := svc.Remove(second)
	if err != nil {
		t.Fatal(err)
	}
	// 删除激活项回退剩余第一条
	if st2.ActiveID == second || len(st2.Connections) != 1 || !st2.Connections[0].Active {
		t.Fatalf("回退异常: %+v", st2)
	}
}

// Test 走假 OpenAI 兼容端点：成功/401/超时 三态（不触真实网络）。
func TestTestConnectionOK(t *testing.T) {
	svc, _ := newSvc(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\ndata: [DONE]\n\n"))
	}))
	defer srv.Close()
	res := svc.Test(TestInput{Provider: "deepseek", Model: "m", APIKey: "k", BaseURL: srv.URL})
	if !res.OK {
		t.Fatalf("期望成功，得 %+v", res)
	}
}

func TestTestConnectionUnauthorized(t *testing.T) {
	svc, _ := newSvc(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"bad key"}}`, http.StatusUnauthorized)
	}))
	defer srv.Close()
	res := svc.Test(TestInput{Provider: "deepseek", Model: "m", APIKey: "bad", BaseURL: srv.URL})
	if res.OK || res.Error != "API Key 无效（401）" {
		t.Fatalf("期望 401 文案，得 %+v", res)
	}
}

func TestTestConnectionTimeout(t *testing.T) {
	svc, _ := newSvc(t)
	svc.testTimeout = 50 * time.Millisecond
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer srv.Close()
	res := svc.Test(TestInput{Provider: "deepseek", Model: "m", APIKey: "k", BaseURL: srv.URL})
	if res.OK || res.Error != "连接超时" {
		t.Fatalf("期望超时文案，得 %+v", res)
	}
}

func TestStateMasksKey(t *testing.T) {
	svc, _ := newSvc(t)
	st, _ := svc.Add(ConnInput{Provider: "deepseek", Model: "m", APIKey: "sk-1234567890abcdef3f2a"})
	if got := st.Connections[0].KeyMasked; got != "sk-••••••••••••••••3f2a" {
		t.Fatalf("掩码 = %q", got)
	}
	if !st.Connections[0].HasKey {
		t.Fatal("HasKey 应为 true")
	}
}
```

imports 补齐：`errors`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run 'TestValidate|TestAdd|TestUpdate|TestRemove|TestTest|TestState'`
Expected: FAIL（NewConfigService/ConnInput 未定义）

- [ ] **Step 3: 实现 config.go**

Create `server/internal/service/config.go`：

```go
package service

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	openai "github.com/sashabaranov/go-openai"

	"lovelybuddy/server/internal/configstore"
	"lovelybuddy/server/internal/llm"
)

// ErrDuplicate 新增连接与既有连接重复（同厂商+BaseURL+模型+key）。
var ErrDuplicate = errors.New("该连接已存在")

// ErrNotFound 操作的连接 id 不存在。
var ErrNotFound = errors.New("连接不存在")

// ConnInput 新增/更新连接请求（POST /api/v1/config/connections、PUT …/:id）。
// Tested/TestOK = 保存前「测试连接」的结果（Tested=false = 从未测试，不落 LastCheck/CheckFail）。
type ConnInput struct {
	Provider  string `json:"provider"`
	BaseURL   string `json:"base_url"`
	Model     string `json:"model"`
	APIKey    string `json:"api_key"` // 更新时为空 = 保留原 key
	MaxTokens int    `json:"max_tokens"`
	Tested    bool   `json:"tested"`
	TestOK    bool   `json:"test_ok"`
}

// TestInput 「测试连接」请求（POST /api/v1/config/test，不落盘）。
type TestInput struct {
	Provider  string `json:"provider"`
	BaseURL   string `json:"base_url"`
	Model     string `json:"model"`
	APIKey    string `json:"api_key"`
	MaxTokens int    `json:"max_tokens"`
}

// ConnectionOut 出参：APIKey 永不携带，只给掩码。
type ConnectionOut struct {
	ID        string     `json:"id"`
	Provider  string     `json:"provider"`
	BaseURL   string     `json:"base_url"`
	Model     string     `json:"model"`
	MaxTokens int        `json:"max_tokens"`
	KeyMasked string     `json:"key_masked"`
	HasKey    bool       `json:"has_key"`
	LastCheck *time.Time `json:"last_check"`
	CheckFail bool       `json:"check_fail"`
	Active    bool       `json:"active"`
}

// ConfigState GET /api/v1/config 出参。
type ConfigState struct {
	ActiveID    string          `json:"active_id"`
	Connections []ConnectionOut `json:"connections"`
}

// TestResult 连通测试结果（成功带 LatencyMS，失败带可读 Error 文案）。
type TestResult struct {
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
	LatencyMS int64  `json:"latency_ms,omitempty"`
}

// ConfigService 连接配置编排：内存态 + 落盘 + 热切换 provider。
// 所有写操作持锁串行；每次写成功后立即落盘并 Swap 注册表。
type ConfigService struct {
	mu          sync.Mutex
	file        *configstore.File
	reg         *llm.Registry
	fallback    llm.ChatProvider // 无激活连接时聊天回退（env/.env 默认厂商）
	testTimeout time.Duration    // 测试可缩短
}

func NewConfigService(reg *llm.Registry, file *configstore.File, fallback llm.ChatProvider) *ConfigService {
	return &ConfigService{file: file, reg: reg, fallback: fallback, testTimeout: 10 * time.Second}
}

// State 当前配置（key 只回掩码）。
func (s *ConfigService) State() ConfigState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state()
}

func (s *ConfigService) state() ConfigState {
	out := ConfigState{ActiveID: s.file.ActiveID}
	for _, c := range s.file.Connections {
		out.Connections = append(out.Connections, ConnectionOut{
			ID: c.ID, Provider: c.Provider, BaseURL: c.BaseURL, Model: c.Model, MaxTokens: c.MaxTokens,
			KeyMasked: configstore.MaskKey(c.APIKey), HasKey: c.APIKey != "",
			LastCheck: c.LastCheck, CheckFail: c.CheckFail, Active: c.ID == s.file.ActiveID,
		})
	}
	return out
}

// Validate 校验连接输入（M3「非法配置拒绝不落盘」的格式层）。
// BaseURL 空 = 厂商默认；http 仅允许本地端点（设计图「本地 Ollama · 127.0.0.1:11434」）。
func Validate(in TestInput) error {
	if _, ok := llm.Providers[in.Provider]; !ok {
		return errors.New("未知服务商: " + in.Provider + "（可选: deepseek, dashscope, zhipu, moonshot）")
	}
	m := strings.TrimSpace(in.Model)
	if m == "" {
		return errors.New("模型名必填")
	}
	if len(m) > 100 {
		return errors.New("模型名过长（≤100 字）")
	}
	if len(in.APIKey) > 512 {
		return errors.New("API Key 过长（≤512 字）")
	}
	if in.BaseURL != "" {
		u, err := url.Parse(in.BaseURL)
		if err != nil || u.Host == "" {
			return errors.New("Base URL 无效")
		}
		host := u.Hostname()
		local := host == "127.0.0.1" || host == "localhost" || host == "::1"
		if u.Scheme != "https" && !(u.Scheme == "http" && local) {
			return errors.New("Base URL 必须为 https（本地端点可用 http）")
		}
	}
	if in.MaxTokens < 0 || in.MaxTokens > 1_000_000 {
		return errors.New("最大 Token 超出范围（0..1000000，0 = 上游默认）")
	}
	return nil
}

// Add 校验→查重→追加→激活→落盘→热切换。重复返回 ErrDuplicate，校验失败返回原错误。
func (s *ConfigService) Add(input ConnInput) (ConfigState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := Validate(toTestInput(input)); err != nil {
		return s.state(), err
	}
	for _, c := range s.file.Connections {
		if c.Provider == input.Provider && c.BaseURL == input.BaseURL &&
			c.Model == input.Model && c.APIKey == input.APIKey {
			return s.state(), ErrDuplicate
		}
	}
	c := s.newConn(input)
	s.file.Add(*c)
	s.file.ActiveID = c.ID
	if err := s.file.Save(); err != nil {
		return s.state(), err
	}
	s.swapActive()
	return s.state(), nil
}

// Update 校验→更新既有连接→激活→落盘→热切换。APIKey 空 = 保留原 key。
func (s *ConfigService) Update(id string, input ConnInput) (ConfigState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.file.Find(id)
	if c == nil {
		return s.state(), ErrNotFound
	}
	if err := Validate(toTestInput(input)); err != nil {
		return s.state(), err
	}
	c.Provider, c.BaseURL, c.Model, c.MaxTokens = input.Provider, input.BaseURL, input.Model, input.MaxTokens
	if input.APIKey != "" {
		c.APIKey = input.APIKey
	}
	s.applyTest(c, input)
	s.file.ActiveID = id
	if err := s.file.Save(); err != nil {
		return s.state(), err
	}
	s.swapActive()
	return s.state(), nil
}

// Remove 删除连接（激活项回退剩余第一条，configstore 内完成）。未知 id 返回 ErrNotFound。
func (s *ConfigService) Remove(id string) (ConfigState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.file.Remove(id) {
		return s.state(), ErrNotFound
	}
	if err := s.file.Save(); err != nil {
		return s.state(), err
	}
	s.swapActive()
	return s.state(), nil
}

// SetActive 切换激活连接。未知 id 返回 ErrNotFound。
func (s *ConfigService) SetActive(id string) (ConfigState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.file.SetActive(id) {
		return s.state(), ErrNotFound
	}
	if err := s.file.Save(); err != nil {
		return s.state(), err
	}
	s.swapActive()
	return s.state(), nil
}

// Test 连通测试：临时建 provider 发 1-token 补全，不落盘不换注册表。
// 失败（含校验失败）返回 OK=false + 可读文案。
func (s *ConfigService) Test(input TestInput) TestResult {
	if err := Validate(input); err != nil {
		return TestResult{OK: false, Error: err.Error()}
	}
	p, err := llm.New(input.Provider, input.Model, input.BaseURL, input.APIKey, 1)
	if err != nil {
		return TestResult{OK: false, Error: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.testTimeout)
	defer cancel()
	start := time.Now()
	for ev := range p.StreamChat(ctx, []llm.Message{{Role: "user", Content: "hi"}}) {
		if ev.Err != nil {
			timedOut := ctx.Err() != nil
			return TestResult{OK: false, Error: classifyTestErr(ev.Err, timedOut)}
		}
	}
	return TestResult{OK: true, LatencyMS: time.Since(start).Milliseconds()}
}

// classifyTestErr 上游错误 → 可读中文文案（不裸透传、不含 key/URL 明文）。
func classifyTestErr(err error, timedOut bool) string {
	if timedOut {
		return "连接超时"
	}
	var apiErr *openai.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.HTTPStatusCode {
		case 401:
			return "API Key 无效（401）"
		case 403:
			return "无权限（403）"
		case 404:
			return "模型或接口路径不存在（404）"
		case 429:
			return "请求过于频繁（429）"
		case 500, 502, 503:
			return "服务商暂时不可用（" + strconv.Itoa(apiErr.HTTPStatusCode) + "）"
		}
	}
	return "连接失败: " + err.Error()
}

// newConn 由输入构造存储连接（含测试结果落盘）。
func (s *ConfigService) newConn(input ConnInput) *configstore.Connection {
	c := &configstore.Connection{
		Provider: input.Provider, BaseURL: input.BaseURL, Model: input.Model,
		MaxTokens: input.MaxTokens, APIKey: input.APIKey,
	}
	s.applyTest(c, input)
	return c
}

// applyTest 落盘保存前的测试结果：Tested 且 OK → LastCheck=now；Tested 且失败 → CheckFail。
func (s *ConfigService) applyTest(c *configstore.Connection, input ConnInput) {
	c.LastCheck, c.CheckFail = nil, false
	if !input.Tested {
		return
	}
	if input.TestOK {
		now := time.Now()
		c.LastCheck = &now
	} else {
		c.CheckFail = true
	}
}

// swapActive 按激活连接重建 provider 并热切换；无激活连接回退 env 默认。
func (s *ConfigService) swapActive() {
	active := s.file.Active()
	if active == nil {
		s.reg.Swap(s.fallback)
		return
	}
	p, err := llm.New(active.Provider, active.Model, active.BaseURL, active.APIKey, active.MaxTokens)
	if err != nil {
		slog.Warn("激活连接无效，回退默认", "err", err)
		s.reg.Swap(s.fallback)
		return
	}
	s.reg.Swap(p)
}

func toTestInput(in ConnInput) TestInput {
	return TestInput{Provider: in.Provider, BaseURL: in.BaseURL, Model: in.Model, APIKey: in.APIKey, MaxTokens: in.MaxTokens}
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/service/ -run 'TestValidate|TestAdd|TestUpdate|TestRemove|TestTest|TestState'`
Expected: PASS（既有 chat/memstore/motionfilter/prompt 测试不受影响）

- [ ] **Step 5: Commit**

```bash
cd server && go vet ./internal/service/
cd .. && git add server/internal/service/config.go server/internal/service/config_test.go && git commit -m "feat(config): 连接配置编排——校验/增删激活/测试连接文案化/热切换"
```

---

### Task 4: /api/v1/config 五端点 + main 接线 + ChatService 持 Registry

**Files:**
- Create: `server/internal/controller/config.go`
- Modify: `server/internal/router/router.go`（Register 加 cfgSvc 参数 + 5 路由）
- Modify: `server/internal/server/server.go`（New 加 cfgSvc 参数）
- Modify: `server/cmd/lovely-buddy-server/main.go`（configstore 载入 + 激活连接优先 + 装配）
- Modify: `server/internal/service/chat.go`（ChatService 持 Registry + 未配 key 文案）
- Test: `server/internal/service/chat_test.go`（6 处构造点改 `llm.NewRegistry(...)`）；`server/internal/server/server_test.go`（构造点同步）

**Interfaces:**
- Consumes: Task 3 全部签名；Task 2 Registry
- Produces: HTTP 契约（Task 5 前端按此对齐）：
  - `GET /api/v1/config` → 200 `ConfigState`
  - `POST /api/v1/config/connections` body `ConnInput` → 200 `ConfigState`；422 `{error}`（校验/重复）；500 `{error:"配置保存失败"}`
  - `PUT /api/v1/config/connections/:id` body `ConnInput` → 200；404/422/500 同上
  - `DELETE /api/v1/config/connections/:id` → 200 `ConfigState`；404/500
  - `POST /api/v1/config/test` body `TestInput` → 200 `TestResult`（失败也是 200 + ok:false）；422 `{error}`

- [ ] **Step 1: 写控制器**

Create `server/internal/controller/config.go`：

```go
package controller

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/service"
)

// Config 模型与连接配置接口（M3 设置面板）。业务全在 service.ConfigService，本层只做 HTTP 胶水。
type Config struct{ svc *service.ConfigService }

func NewConfig(svc *service.ConfigService) *Config { return &Config{svc: svc} }

// State GET /api/v1/config → 当前配置（key 只回掩码）。
func (h *Config) State(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.State())
}

// Add POST /api/v1/config/connections → 校验+保存+激活；非法 422 不落盘。
func (h *Config) Add(c *gin.Context) {
	var req service.ConnInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	state, err := h.svc.Add(req)
	h.respondMutation(c, state, err)
}

// Update PUT /api/v1/config/connections/:id → 更新+激活（key 空 = 保留原 key）。
func (h *Config) Update(c *gin.Context) {
	var req service.ConnInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	state, err := h.svc.Update(c.Param("id"), req)
	h.respondMutation(c, state, err)
}

// Remove DELETE /api/v1/config/connections/:id → 删除（激活项回退剩余第一条）。
func (h *Config) Remove(c *gin.Context) {
	state, err := h.svc.Remove(c.Param("id"))
	h.respondMutation(c, state, err)
}

// SetActive PUT /api/v1/config/active body {id} → 切换激活连接。
func (h *Config) SetActive(c *gin.Context) {
	var req struct {
		ID string `json:"id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	state, err := h.svc.SetActive(req.ID)
	h.respondMutation(c, state, err)
}

// Test POST /api/v1/config/test → 连通测试（失败也是 200 + ok:false，前端浮红字保留输入）。
func (h *Config) Test(c *gin.Context) {
	var req service.TestInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	c.JSON(http.StatusOK, h.svc.Test(req))
}

// respondMutation 写操作统一出口：ErrNotFound→404、ErrDuplicate/校验错误→422、
// 落盘失败→500，其余 200 回全量 ConfigState。
func (h *Config) respondMutation(c *gin.Context, state service.ConfigState, err error) {
	switch {
	case err == nil:
		c.JSON(http.StatusOK, state)
	case errors.Is(err, service.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrDuplicate):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
	default:
		// Validate 的错误与 Save 失败都落这里；区分方式：Save 失败日志 + 500，其余 422。
		slog.Error("config: 变更失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "配置保存失败"})
	}
}
```

注意：校验错误也需要 422——`Add/Update` 内部先 `Validate` 再落盘，校验错误同样走到 default 分支。为区分，把 `Add/Update` 里的校验错误用 `ErrInvalid` 包装：在 `service/config.go` 的 `Add/Update` 中，把 `Validate` 的错误原样返回，controller 用「`service.Validate` 提前独立调用」区分：

`controller/config.go` 的 `Add/Update` 在调 `h.svc.Add/Update` 前先自己校验（同一 `service.Validate`，纯函数幂等）：

```go
// Add 前先校验（与 service 内部校验同源，422 不落盘；service 内部仍会再校验一次兜底）
	if err := service.Validate(service.TestInput{
		Provider: req.Provider, BaseURL: req.BaseURL, Model: req.Model, APIKey: req.APIKey, MaxTokens: req.MaxTokens,
	}); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
```

（Update 同款。）`respondMutation` 的 default 分支则只可能是落盘失败 → 500。最终 `respondMutation`：

```go
func (h *Config) respondMutation(c *gin.Context, state service.ConfigState, err error) {
	switch {
	case err == nil:
		c.JSON(http.StatusOK, state)
	case errors.Is(err, service.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrDuplicate):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
	default:
		slog.Error("config: 配置保存失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "配置保存失败"})
	}
}
```

- [ ] **Step 2: router 注册**

Modify `server/internal/router/router.go`：`Register` 签名加 `cfgSvc *service.ConfigService`，在 chat 路由后追加：

```go
	cfgCtl := controller.NewConfig(cfgSvc)
	api.GET("/config", cfgCtl.State)
	api.POST("/config/connections", cfgCtl.Add)
	api.PUT("/config/connections/:id", cfgCtl.Update)
	api.DELETE("/config/connections/:id", cfgCtl.Remove)
	api.PUT("/config/active", cfgCtl.SetActive)
	api.POST("/config/test", cfgCtl.Test)
```

（cfgSvc 为 nil 时 controller 会 panic——与既有 `chats` nil 的 503 兜底不同，config 始终由 main 装配非 nil；server_test 装配见 Step 5。）

- [ ] **Step 3: server.New 加参数**

Modify `server/internal/server/server.go`：`New(addr, token string, pool *pgxpool.Pool, modelDir string, chats *service.ChatService, cfgSvc *service.ConfigService)`，`router.Register(r, pool, token, modelDir, chats, cfgSvc)`。

- [ ] **Step 4: main.go 接线（激活连接优先、env 兜底）**

Modify `server/cmd/lovely-buddy-server/main.go`，替换 `cfg := config.Load()` 到 `chats := …` 一段：

```go
	cfg := config.Load()
	fallback, err := llm.Resolve(cfg.Chat.Provider, cfg.Chat.Model, cfg.Chat.BaseURL)
	if err != nil {
		slog.Error("对话厂商配置无效", "err", err)
		os.Exit(1)
	}
	reg := llm.NewRegistry(fallback)

	file, err := configstore.Load()
	if err != nil {
		slog.Warn("模型与连接配置读取失败，忽略", "err", err)
		file = &configstore.File{}
	}
	if active := file.Active(); active != nil {
		if p, err := llm.New(active.Provider, active.Model, active.BaseURL, active.APIKey, active.MaxTokens); err != nil {
			slog.Warn("已保存的连接无效，回退环境默认", "err", err)
		} else {
			reg.Swap(p)
		}
	}
	cfgSvc := service.NewConfigService(reg, file, fallback)

	chats := service.NewChatService(dao.NewChat(pool), reg, *modelDir)
	srv := server.New(*addr, *token, pool, *modelDir, chats, cfgSvc)
```

imports 加 `"lovelybuddy/server/internal/configstore"`；原 `provider` 变量重命名为 `fallback`。

- [ ] **Step 5: ChatService 持 Registry + 文案**

Modify `server/internal/service/chat.go`：

```go
type ChatService struct {
	store    ChatStore
	reg      *llm.Registry
	modelDir string
}

func NewChatService(store ChatStore, reg *llm.Registry, modelDir string) *ChatService {
	return &ChatService{store: store, reg: reg, modelDir: modelDir}
}
```

`Stream` 的 goroutine 开头改为：

```go
	go func() {
		defer close(ch)
		provider := s.reg.Current() // 对话发起时捕获：切换连接不影响本次回复
		if !provider.Configured() {
			ch <- Event{Type: "error", Error: "未配置 API key：请在设置·模型与连接中添加连接，或在 .env 填写 " + provider.KeyEnv()}
			return
		}
```

其余不动（`s.provider.StreamChat` → `provider.StreamChat`）。

- [ ] **Step 6: 既有测试构造点更新**

`server/internal/service/chat_test.go`：6 处 `NewChatService(store, X, dir)` 改为 `NewChatService(store, llm.NewRegistry(X), dir)`，imports 加 `"lovelybuddy/server/internal/llm"`。逐处替换：

```go
	s := NewChatService(store, llm.NewRegistry(&scriptedProvider{}), t.TempDir())
	s := NewChatService(store, llm.NewRegistry(p), t.TempDir())
	s := NewChatService(store, llm.NewRegistry(p), dir)
	s := NewChatService(store, llm.NewRegistry(&scriptedProvider{}), t.TempDir())
```

`server/internal/server/server_test.go`：

```go
	chats := service.NewChatService(service.NewMemStore(), llm.NewRegistry(scriptedLLM{}), root)
	srv := New(addr, token, pool, root, chats, service.NewConfigService(llm.NewRegistry(scriptedLLM{}), &configstore.File{}, scriptedLLM{}))
```

imports 加 `"lovelybuddy/server/internal/llm"`、`"lovelybuddy/server/internal/configstore"`。

- [ ] **Step 7: 控制器测试**

Create `server/internal/controller/config_test.go`：

```go
package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/configstore"
	"lovelybuddy/server/internal/llm"
	"lovelybuddy/server/internal/service"
)

func newConfigRouter(t *testing.T) *gin.Engine {
	t.Helper()
	t.Setenv("LOVELYBUDDY_CONFIG_FILE", filepath.Join(t.TempDir(), "config.json"))
	file, _ := configstore.Load()
	fallback, _ := llm.New("deepseek", "", "", "", 0)
	svc := service.NewConfigService(llm.NewRegistry(fallback), file, fallback)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	ctl := NewConfig(svc)
	r.GET("/config", ctl.State)
	r.POST("/config/connections", ctl.Add)
	r.PUT("/config/connections/:id", ctl.Update)
	r.DELETE("/config/connections/:id", ctl.Remove)
	r.PUT("/config/active", ctl.SetActive)
	r.POST("/config/test", ctl.Test)
	return r
}

func doJSON(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAddAndStateRoundtrip(t *testing.T) {
	r := newConfigRouter(t)
	w := doJSON(t, r, http.MethodPost, "/config/connections",
		`{"provider":"deepseek","model":"deepseek-chat","api_key":"sk-1234567890abcdef3f2a","max_tokens":0}`)
	if w.Code != http.StatusOK {
		t.Fatalf("Add = %d %s", w.Code, w.Body.String())
	}
	var st service.ConfigState
	_ = json.Unmarshal(w.Body.Bytes(), &st)
	if len(st.Connections) != 1 || st.Connections[0].KeyMasked != "sk-••••••••••••••••3f2a" {
		t.Fatalf("掩码/结构异常: %+v", st)
	}
	if strings.Contains(w.Body.String(), "1234567890") {
		t.Fatal("响应不得携带 key 明文")
	}
	// 非法配置 422 且不落盘
	w2 := doJSON(t, r, http.MethodPost, "/config/connections",
		`{"provider":"nope","model":"m","api_key":"k"}`)
	if w2.Code != http.StatusUnprocessableEntity {
		t.Fatalf("非法配置应 422，得 %d", w2.Code)
	}
	w3 := doJSON(t, r, http.MethodGet, "/config", "")
	if w3.Code != http.StatusOK || !strings.Contains(w3.Body.String(), `"connections":[{`) {
		t.Fatalf("422 后配置不应变化: %s", w3.Body.String())
	}
}

func TestUpdateNotFoundAndKeepKey(t *testing.T) {
	r := newConfigRouter(t)
	doJSON(t, r, http.MethodPost, "/config/connections", `{"provider":"deepseek","model":"m","api_key":"k1"}`)
	w := doJSON(t, r, http.MethodPut, "/config/connections/ghost", `{"provider":"deepseek","model":"m"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("未知 id 应 404，得 %d", w.Code)
	}
	w2 := doJSON(t, r, http.MethodGet, "/config", "")
	var st service.ConfigState
	_ = json.Unmarshal(w2.Body.Bytes(), &st)
	id := st.Connections[0].ID
	w3 := doJSON(t, r, http.MethodPut, "/config/connections/"+id, `{"provider":"deepseek","model":"deepseek-reasoner"}`)
	if w3.Code != http.StatusOK {
		t.Fatalf("Update = %d", w3.Code)
	}
	got, _ := configstore.Load()
	if got.Connections[0].APIKey != "k1" {
		t.Fatal("空 key 更新应保留原 key")
	}
}

func TestDeleteActiveFallsBackAndTestEndpoint(t *testing.T) {
	r := newConfigRouter(t)
	w := doJSON(t, r, http.MethodPost, "/config/connections", `{"provider":"deepseek","model":"m","api_key":"k1"}`)
	var st service.ConfigState
	_ = json.Unmarshal(w.Body.Bytes(), &st)
	id := st.Connections[0].ID
	w2 := doJSON(t, r, http.MethodDelete, "/config/connections/"+id, "")
	if w2.Code != http.StatusOK {
		t.Fatalf("Delete = %d", w2.Code)
	}
	var st2 service.ConfigState
	_ = json.Unmarshal(w2.Body.Bytes(), &st2)
	if st2.ActiveID != "" {
		t.Fatalf("删光后 active 应为空: %+v", st2)
	}
	// 校验失败 422
	w3 := doJSON(t, r, http.MethodPost, "/config/test", `{"provider":"deepseek","model":"  "}`)
	if w3.Code != http.StatusUnprocessableEntity {
		t.Fatalf("Test 校验失败应 422，得 %d", w3.Code)
	}
}
```

- [ ] **Step 8: 全量 Go 测试 + vet**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全 PASS

- [ ] **Step 9: Commit**

```bash
git add server/internal/controller/ server/internal/router/ server/internal/server/ server/cmd/ server/internal/service/chat.go server/internal/service/chat_test.go
git commit -m "feat(config): /api/v1/config 五端点 + 启动装配（界面注入优先、env 兜底）+ chat 持 registry"
```

---

### Task 5: 前端 configApi + connectionStore

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/configApi.ts`
- Create: `apps/desktop/src/renderer/src/store/connectionStore.ts`
- Test: `apps/desktop/src/renderer/src/lib/__test__/configApi.test.ts`（新建）；`apps/desktop/src/renderer/src/store/__test__/connectionStore.test.ts`（新建，参照 chatStore/petStore 既有测试位置）

**Interfaces:**
- Consumes: Task 4 HTTP 契约；`window.lovelybuddy.getRuntime()`（既有模式，见 petStore.ts:58）
- Produces: `fetchConfig(rt) → ConfigState`、`addConnection(rt, input) → ConfigState`、`updateConnection(rt, id, input) → ConfigState`、`deleteConnection(rt, id) → ConfigState`、`testConnection(rt, input) → TestResult`；`useConnectionStore`（zustand：`config/loading/error/formOpen/editing/saving/testing/testResult` 状态 + `load/openAdd/openEdit/closeForm/add/update/remove/test/clearTest` 动作）——Task 6/7 按这些签名使用

- [ ] **Step 1: 写 configApi（含测试先红）**

Create `apps/desktop/src/renderer/src/lib/__test__/configApi.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addConnection, deleteConnection, fetchConfig, testConnection, updateConnection } from '../configApi'
import type { ApiRuntime } from '../assetsApi'

const rt: ApiRuntime = { baseUrl: 'http://127.0.0.1:8740', token: 'dev' }

const sampleState = {
  active_id: 'c1',
  connections: [
    {
      id: 'c1',
      provider: 'deepseek',
      base_url: '',
      model: 'deepseek-chat',
      max_tokens: 0,
      key_masked: 'sk-••••••••••••••••3f2a',
      has_key: true,
      last_check: null,
      check_fail: false,
      active: true
    }
  ]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('configApi', () => {
  it('fetchConfig 带 Bearer token 并解析状态', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleState), { status: 200 })
    )
    const st = await fetchConfig(rt)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8740/api/v1/config',
      expect.objectContaining({ headers: { Authorization: 'Bearer dev' } })
    )
    expect(st.connections[0].key_masked).toContain('••••')
  })

  it('addConnection 发送 JSON body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleState), { status: 200 })
    )
    await addConnection(rt, { provider: 'deepseek', model: 'm', api_key: 'k', base_url: '', max_tokens: 0, tested: true, test_ok: true })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      provider: 'deepseek',
      model: 'm',
      api_key: 'k',
      base_url: '',
      max_tokens: 0,
      tested: true,
      test_ok: true
    })
  })

  it('422 错误透出服务端中文文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: '该连接已存在' }), { status: 422 })
    )
    await expect(
      addConnection(rt, { provider: 'deepseek', model: 'm', api_key: '', base_url: '', max_tokens: 0 })
    ).rejects.toThrow('该连接已存在')
  })

  it('updateConnection PUT 到 /:id，deleteConnection DELETE /:id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleState), { status: 200 })
    )
    await updateConnection(rt, 'c1', { provider: 'deepseek', model: 'm2', api_key: '', base_url: '', max_tokens: 0 })
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/v1/config/connections/c1')
    await deleteConnection(rt, 'c1')
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain('/api/v1/config/connections/c1')
  })

  it('testConnection 失败也正常返回 ok:false 不 throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'API Key 无效（401）' }), { status: 200 })
    )
    const res = await testConnection(rt, { provider: 'deepseek', model: 'm', api_key: 'bad', base_url: '', max_tokens: 0 })
    expect(res).toEqual({ ok: false, error: 'API Key 无效（401）' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/lib/__test__/configApi.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 configApi.ts**

Create `apps/desktop/src/renderer/src/lib/configApi.ts`：

```ts
// 模型与连接 API 客户端：与 Go 后端 /api/v1/config 通信（Bearer token）。
// 服务端永不回传 API Key 明文，只给掩码（key_masked）。
import type { ApiRuntime } from './assetsApi'

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
}

export interface ConfigState {
  active_id: string
  connections: ConnectionInfo[]
}

export interface ConnInput {
  provider: string
  base_url: string
  model: string
  api_key: string
  max_tokens: number
  /** 保存前执行过「测试连接」；test_ok = 其结果 */
  tested?: boolean
  test_ok?: boolean
}

export interface TestResult {
  ok: boolean
  error?: string
  latency_ms?: number
}

function authHeaders(rt: ApiRuntime): Record<string, string> {
  return { Authorization: `Bearer ${rt.token}` }
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null
  return new Error(data?.error ?? fallback)
}

export async function fetchConfig(rt: ApiRuntime): Promise<ConfigState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config`, { headers: authHeaders(rt) })
  if (!res.ok) throw await parseError(res, `配置读取失败: HTTP ${res.status}`)
  return (await res.json()) as ConfigState
}

export async function addConnection(rt: ApiRuntime, input: ConnInput): Promise<ConfigState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config/connections`, {
    method: 'POST',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw await parseError(res, `保存失败: HTTP ${res.status}`)
  return (await res.json()) as ConfigState
}

export async function updateConnection(rt: ApiRuntime, id: string, input: ConnInput): Promise<ConfigState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config/connections/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw await parseError(res, `保存失败: HTTP ${res.status}`)
  return (await res.json()) as ConfigState
}

export async function deleteConnection(rt: ApiRuntime, id: string): Promise<ConfigState> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(rt)
  })
  if (!res.ok) throw await parseError(res, `删除失败: HTTP ${res.status}`)
  return (await res.json()) as ConfigState
}

export async function testConnection(rt: ApiRuntime, input: ConnInput): Promise<TestResult> {
  const res = await fetch(`${rt.baseUrl}/api/v1/config/test`, {
    method: 'POST',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw await parseError(res, `测试失败: HTTP ${res.status}`)
  return (await res.json()) as TestResult
}
```

- [ ] **Step 4: 写 connectionStore 测试（先红）**

Create `apps/desktop/src/renderer/src/store/__test__/connectionStore.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '../connectionStore'

const sampleState = {
  active_id: 'c1',
  connections: [
    {
      id: 'c1',
      provider: 'deepseek',
      base_url: '',
      model: 'deepseek-chat',
      max_tokens: 0,
      key_masked: 'sk-••••••••••••••••3f2a',
      has_key: true,
      last_check: null,
      check_fail: false,
      active: true
    }
  ]
}

beforeEach(() => {
  vi.stubGlobal('lovelybuddy', {
    getRuntime: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:8740', token: 'dev' })
  })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(sampleState), { status: 200 }))
  useConnectionStore.setState({
    config: null,
    error: null,
    formOpen: false,
    editing: null,
    testResult: null
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('connectionStore', () => {
  it('load 拉取配置', async () => {
    await useConnectionStore.getState().load()
    expect(useConnectionStore.getState().config?.connections).toHaveLength(1)
    expect(useConnectionStore.getState().loading).toBe(false)
  })

  it('add 成功：保存并关闭表单，tested/test_ok 跟随最近一次测试结果', async () => {
    await useConnectionStore.getState().test({ provider: 'deepseek', base_url: '', model: 'm', api_key: 'k', max_tokens: 0 })
    await useConnectionStore.getState().add({ provider: 'deepseek', base_url: '', model: 'm', api_key: 'k', max_tokens: 0 })
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.tested).toBe(true)
    expect(body.test_ok).toBe(true)
    expect(useConnectionStore.getState().formOpen).toBe(false)
  })

  it('add 失败：错误透出且表单保持打开', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: '该连接已存在' }), { status: 422 })
    )
    useConnectionStore.setState({ formOpen: true })
    await useConnectionStore.getState().add({ provider: 'deepseek', base_url: '', model: 'm', api_key: 'k', max_tokens: 0 })
    expect(useConnectionStore.getState().error).toBe('该连接已存在')
    expect(useConnectionStore.getState().formOpen).toBe(true)
  })

  it('update 走 PUT（编辑模式），api_key 空 = 保留原 key', async () => {
    await useConnectionStore.getState().update('c1', { provider: 'deepseek', base_url: '', model: 'm2', api_key: '', max_tokens: 0 })
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('/api/v1/config/connections/c1')
  })

  it('remove 与 openEdit/closeForm 状态流转', async () => {
    useConnectionStore.getState().openEdit(sampleState.connections[0])
    expect(useConnectionStore.getState().editing?.id).toBe('c1')
    useConnectionStore.getState().closeForm()
    expect(useConnectionStore.getState().editing).toBeNull()
    await useConnectionStore.getState().remove('c1')
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('DELETE')
  })

  it('test 失败：testResult 记红字文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'API Key 无效（401）' }), { status: 200 })
    )
    await useConnectionStore.getState().test({ provider: 'deepseek', base_url: '', model: 'm', api_key: 'bad', max_tokens: 0 })
    expect(useConnectionStore.getState().testResult).toEqual({ ok: false, message: 'API Key 无效（401）' })
  })
})
```

- [ ] **Step 5: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/store/__test__/connectionStore.test.ts`
Expected: FAIL（store 不存在）

- [ ] **Step 6: 实现 connectionStore.ts**

Create `apps/desktop/src/renderer/src/store/connectionStore.ts`：

```ts
// 模型与连接全局状态：配置列表 + 新增/编辑表单流程（测试连接→保存并启用）。
// 保存时带上最近一次「测试连接」的结果（tested/test_ok），服务端据此落 LastCheck/CheckFail。
import { create } from 'zustand'
import {
  addConnection,
  deleteConnection,
  fetchConfig,
  testConnection,
  updateConnection,
  type ConfigState,
  type ConnInput,
  type ConnectionInfo
} from '../lib/configApi'

interface ConnectionStore {
  config: ConfigState | null
  loading: boolean
  error: string | null // 页面级错误（读取/保存失败）
  formOpen: boolean
  editing: ConnectionInfo | null // 编辑模式的行（null = 新增）
  saving: boolean
  testing: boolean
  testResult: { ok: boolean; message: string } | null
  load: () => Promise<void>
  openAdd: () => void
  openEdit: (c: ConnectionInfo) => void
  closeForm: () => void
  add: (input: ConnInput) => Promise<void>
  update: (id: string, input: ConnInput) => Promise<void>
  remove: (id: string) => Promise<void>
  test: (input: ConnInput) => Promise<void>
  clearTest: () => void
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  config: null,
  loading: false,
  error: null,
  formOpen: false,
  editing: null,
  saving: false,
  testing: false,
  testResult: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      set({ config: await fetchConfig(rt) })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '配置读取失败' })
    } finally {
      set({ loading: false })
    }
  },

  openAdd: () => set({ formOpen: true, editing: null, testResult: null }),
  openEdit: (c) => set({ formOpen: true, editing: c, testResult: null }),
  closeForm: () => set({ formOpen: false, editing: null, testResult: null, error: null }),

  add: async (input) => {
    set({ saving: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const testResult = get().testResult
      const config = await addConnection(rt, {
        ...input,
        tested: testResult !== null,
        test_ok: testResult?.ok === true
      })
      set({ config, formOpen: false, testResult: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '保存失败' })
    } finally {
      set({ saving: false })
    }
  },

  update: async (id, input) => {
    set({ saving: true, error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const testResult = get().testResult
      const config = await updateConnection(rt, id, {
        ...input,
        tested: testResult !== null,
        test_ok: testResult?.ok === true
      })
      set({ config, formOpen: false, editing: null, testResult: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '保存失败' })
    } finally {
      set({ saving: false })
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      set({ config: await deleteConnection(rt, id) })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '删除失败' })
    }
  },

  test: async (input) => {
    set({ testing: true })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const r = await testConnection(rt, input)
      set({
        testResult: r.ok
          ? { ok: true, message: `连接成功 · ${r.latency_ms ?? 0}ms` }
          : { ok: false, message: r.error ?? '连接失败' }
      })
    } catch (e) {
      set({ testResult: { ok: false, message: e instanceof Error ? e.message : '测试失败' } })
    } finally {
      set({ testing: false })
    }
  },

  clearTest: () => set({ testResult: null })
}))
```

- [ ] **Step 7: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/lib/__test__/configApi.test.ts src/renderer/src/store/__test__/connectionStore.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd apps/desktop && pnpm format:check && pnpm typecheck
cd ../.. && git add apps/desktop/src/renderer/src/lib/configApi.ts apps/desktop/src/renderer/src/lib/__test__/configApi.test.ts apps/desktop/src/renderer/src/store/connectionStore.ts apps/desktop/src/renderer/src/store/__test__/connectionStore.test.ts
git commit -m "feat(connection): 模型与连接 api 客户端与 zustand store（测试连接结果随保存落盘）"
```

---

### Task 6: ConnectionPage —— 当前模型卡 / 连接行三态 / 新增编辑表单

**Files:**
- Create: `apps/desktop/src/renderer/src/pet/settings/connectionFormat.ts`
- Create: `apps/desktop/src/renderer/src/pet/settings/ConnectionPage.tsx`
- Test: `apps/desktop/src/renderer/src/pet/settings/__test__/connectionFormat.test.ts`（新建）；`apps/desktop/src/renderer/src/pet/settings/__test__/ConnectionPage.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 5 `useConnectionStore`/`ConnectionInfo`/`ConnInput`；Task 1 设计 token（tokens.css）
- Produces: `ConnectionPage` 默认导出（Task 7 挂进 SettingsPanel）；`relTime(t: string | null): string`、`providerLabel(p: string): string`、`hostOf(c: ConnectionInfo): string`（测试引用）

- [ ] **Step 1: 写 connectionFormat 测试（先红）**

Create `apps/desktop/src/renderer/src/pet/settings/__test__/connectionFormat.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { hostOf, providerLabel, relTime } from '../connectionFormat'
import type { ConnectionInfo } from '../../../lib/configApi'

const base = { max_tokens: 0, key_masked: '', has_key: false, last_check: null, check_fail: false, active: false }

describe('connectionFormat', () => {
  it('relTime 相对时间', () => {
    expect(relTime(null)).toBe('尚未校验')
    const now = Date.now()
    expect(relTime(new Date(now - 30_000).toISOString())).toBe('刚刚校验通过')
    expect(relTime(new Date(now - 3 * 60_000).toISOString())).toBe('3 分钟前校验通过')
  })

  it('relTime 跨天显示日期', () => {
    const yesterday = new Date(Date.now() - 24 * 3600_000)
    const got = relTime(yesterday.toISOString())
    expect(got).toContain('校验通过')
    expect(got).not.toContain('分钟前')
  })

  it('providerLabel 映射与未知兜底', () => {
    expect(providerLabel('deepseek')).toBe('DeepSeek')
    expect(providerLabel('dashscope')).toBe('阿里云百炼')
    expect(providerLabel('zhipu')).toBe('智谱 AI')
    expect(providerLabel('moonshot')).toBe('月之暗面 Kimi')
    expect(providerLabel('unknown')).toBe('unknown')
  })

  it('hostOf：base_url 优先，空用厂商默认域名', () => {
    expect(hostOf({ ...base, id: 'x', provider: 'deepseek', base_url: 'https://api.deepseek.com/v1', model: 'm' })).toBe('api.deepseek.com')
    expect(hostOf({ ...base, id: 'x', provider: 'moonshot', base_url: '', model: 'm' })).toBe('api.moonshot.cn')
    expect(hostOf({ ...base, id: 'x', provider: 'deepseek', base_url: 'http://127.0.0.1:11434/v1', model: 'm' })).toBe('127.0.0.1:11434')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/settings/__test__/connectionFormat.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 connectionFormat.ts**

Create `apps/desktop/src/renderer/src/pet/settings/connectionFormat.ts`：

```ts
// 模型与连接页纯展示换算：相对校验时间 / 厂商显示名 / 域名。与后端 registry 的默认地址镜像。
import type { ConnectionInfo } from '../../lib/configApi'

export const PROVIDER_LABEL: Record<string, string> = {
  deepseek: 'DeepSeek',
  dashscope: '阿里云百炼',
  zhipu: '智谱 AI',
  moonshot: '月之暗面 Kimi'
}

const PROVIDER_DEFAULT_URL: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  moonshot: 'https://api.moonshot.cn/v1'
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}

/** base_url → host；空用厂商默认域名（与 Go llm.Providers 镜像）。 */
export function hostOf(c: ConnectionInfo): string {
  const raw = c.base_url || PROVIDER_DEFAULT_URL[c.provider] || ''
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
}

/** 最近校验时间 → 设计图文案：刚刚/N 分钟前校验通过、今天 HH:mm 校验通过、M月D日 HH:mm 校验通过。 */
export function relTime(t: string | null): string {
  if (!t) return '尚未校验'
  const d = new Date(t)
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return '刚刚校验通过'
  if (mins < 60) return `${mins} 分钟前校验通过`
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? `今天 ${hm} 校验通过` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm} 校验通过`
}
```

- [ ] **Step 4: 写 ConnectionPage 测试（先红）**

Create `apps/desktop/src/renderer/src/pet/settings/__test__/ConnectionPage.test.tsx`：

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectionPage from '../ConnectionPage'
import { useConnectionStore } from '../../../store/connectionStore'
import type { ConfigState, ConnectionInfo } from '../../../lib/configApi'

const conn = (over: Partial<ConnectionInfo>): ConnectionInfo => ({
  id: 'c1',
  provider: 'deepseek',
  base_url: '',
  model: 'deepseek-chat',
  max_tokens: 0,
  key_masked: 'sk-••••••••••••••••3f2a',
  has_key: true,
  last_check: new Date(Date.now() - 3 * 60_000).toISOString(),
  check_fail: false,
  active: true,
  ...over
})

const removeMock = vi.fn()
const testMock = vi.fn()
const addMock = vi.fn()
const updateMock = vi.fn()

function seed(cfg: ConfigState): void {
  useConnectionStore.setState({
    config: cfg,
    formOpen: false,
    editing: null,
    testing: false,
    testResult: null,
    error: null,
    remove: removeMock,
    test: testMock,
    add: addMock,
    update: updateMock
  })
}

beforeEach(() => {
  removeMock.mockReset()
  testMock.mockReset()
  addMock.mockReset()
  updateMock.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ConnectionPage', () => {
  it('页头 meta：当前模型 + 连接数', () => {
    seed({ active_id: 'c1', connections: [conn({}), conn({ id: 'c2', active: false })] })
    render(<ConnectionPage />)
    expect(screen.getByRole('heading', { name: '模型与连接' })).toBeTruthy()
    expect(screen.getByText('当前 deepseek-chat · 共 2 个连接')).toBeTruthy()
  })

  it('当前模型卡：服务商·模型 + 域名·校验时间 + 已连接', () => {
    seed({ active_id: 'c1', connections: [conn({})] })
    render(<ConnectionPage />)
    expect(screen.getByText('DeepSeek · deepseek-chat')).toBeTruthy()
    expect(screen.getByText('api.deepseek.com · 3 分钟前校验通过')).toBeTruthy()
    expect(screen.getByText('已连接')).toBeTruthy()
  })

  it('当前模型卡未校验态：灰点未连接 + 尚未校验', () => {
    seed({ active_id: 'c1', connections: [conn({ last_check: null })] })
    render(<ConnectionPage />)
    expect(screen.getByText('未连接')).toBeTruthy()
    expect(screen.getByText('api.deepseek.com · 尚未校验')).toBeTruthy()
  })

  it('无连接空态', () => {
    seed({ active_id: '', connections: [] })
    render(<ConnectionPage />)
    expect(screen.getByText('尚未配置连接，添加后即可对话')).toBeTruthy()
  })

  it('行三态：使用中徽章 / 未使用 / 未连接灰点', () => {
    seed({
      active_id: 'c1',
      connections: [
        conn({}),
        conn({ id: 'c2', active: false, check_fail: false, last_check: null }),
        conn({ id: 'c3', active: false, check_fail: true, model: 'qwen2.5', base_url: 'http://127.0.0.1:11434/v1' })
      ]
    })
    render(<ConnectionPage />)
    expect(screen.getByText('使用中')).toBeTruthy()
    expect(screen.getByText('未使用')).toBeTruthy()
    expect(screen.getByText('未连接')).toBeTruthy()
    expect(screen.getByText('127.0.0.1:11434 · 服务未启动')).toBeTruthy()
  })

  it('删除激活连接二次确认并调 remove；非激活直接删', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    seed({ active_id: 'c1', connections: [conn({}), conn({ id: 'c2', active: false, provider: 'dashscope', model: 'qwen-plus' })] })
    render(<ConnectionPage />)
    const delBtns = screen.getAllByRole('button', { name: /删除连接/ })
    fireEvent.click(delBtns[0])
    expect(confirmSpy).toHaveBeenCalledWith('删除当前连接「DeepSeek」？聊天将回退到默认配置。此操作不可恢复。')
    fireEvent.click(delBtns[1])
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(removeMock).toHaveBeenCalledTimes(2))
  })

  it('添加连接按钮开表单，表单字段齐全，保存调用 add 且带上测试结果', async () => {
    seed({ active_id: '', connections: [] })
    useConnectionStore.setState({ openAdd: () => useConnectionStore.setState({ formOpen: true }) })
    render(<ConnectionPage />)
    fireEvent.click(screen.getByRole('button', { name: /添加连接/ }))
    expect(screen.getByLabelText('服务商')).toBeTruthy()
    expect(screen.getByLabelText('Base URL')).toBeTruthy()
    expect(screen.getByLabelText('API Key')).toBeTruthy()
    expect(screen.getByLabelText('模型名')).toBeTruthy()
    expect(screen.getByLabelText('最大 Token')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('模型名'), { target: { value: 'deepseek-reasoner' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并启用' }))
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'deepseek', model: 'deepseek-reasoner', api_key: '', max_tokens: 0 })
      )
    )
  })

  it('测试连接：按钮 loading 文案「测试中…」', async () => {
    seed({ active_id: '', connections: [] })
    useConnectionStore.setState({ openAdd: () => useConnectionStore.setState({ formOpen: true }), testing: true })
    render(<ConnectionPage />)
    fireEvent.click(screen.getByRole('button', { name: /添加连接/ }))
    expect(screen.getByRole('button', { name: '测试中…' })).toBeTruthy()
  })

  it('测试失败红字保留输入（字段值不变）', () => {
    seed({ active_id: '', connections: [] })
    useConnectionStore.setState({
      openAdd: () => useConnectionStore.setState({ formOpen: true }),
      testResult: { ok: false, message: 'API Key 无效（401）' }
    })
    render(<ConnectionPage />)
    fireEvent.click(screen.getByRole('button', { name: /添加连接/ }))
    fireEvent.change(screen.getByLabelText('模型名'), { target: { value: 'gpt-4o-mini' } })
    const result = screen.getByText('API Key 无效（401）')
    expect(result.className).toContain('text-accent-ink')
    expect((screen.getByLabelText('模型名') as HTMLInputElement).value).toBe('gpt-4o-mini')
  })

  it('点击行打开编辑表单：key 掩码 + 已保存 tag，保存走 update', async () => {
    seed({ active_id: 'c1', connections: [conn({})] })
    useConnectionStore.setState({ openEdit: (c: ConnectionInfo) => useConnectionStore.setState({ formOpen: true, editing: c }) })
    render(<ConnectionPage />)
    fireEvent.click(screen.getByText('使用中'))
    await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
    expect(screen.getByText('sk-••••••••••••••••3f2a')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存并启用' }))
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('c1', expect.objectContaining({ api_key: '' })))
  })
})
```

- [ ] **Step 5: 跑测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/settings/__test__/ConnectionPage.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 6: 实现 ConnectionPage.tsx**

Create `apps/desktop/src/renderer/src/pet/settings/ConnectionPage.tsx`：

```tsx
import { useState, type FormEvent, type ReactElement } from 'react'
import { useConnectionStore } from '../../store/connectionStore'
import type { ConnectionInfo } from '../../lib/configApi'
import { hostOf, providerLabel, relTime } from './connectionFormat'

/** 表单字段本地态（编辑模式下 key 未动 = api_key 留空提交，服务端保留原 key）。 */
interface FormState {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: string
}

const EMPTY_FORM: FormState = { provider: 'deepseek', baseUrl: '', apiKey: '', model: '', maxTokens: '' }

function formFromConn(c: ConnectionInfo): FormState {
  return {
    provider: c.provider,
    baseUrl: c.base_url,
    apiKey: '',
    model: c.model,
    maxTokens: c.max_tokens > 0 ? String(c.max_tokens) : ''
  }
}

/** 表单输入 → 请求体（maxTokens 空/非数字 = 0；编辑模式 key 未动 = 空字符串保留原 key）。 */
function buildInput(f: FormState): { provider: string; base_url: string; model: string; api_key: string; max_tokens: number } {
  const n = Number.parseInt(f.maxTokens, 10)
  return {
    provider: f.provider,
    base_url: f.baseUrl.trim(),
    model: f.model.trim(),
    api_key: f.apiKey,
    max_tokens: Number.isFinite(n) && n > 0 ? n : 0
  }
}

const inputCls =
  'h-8 w-full rounded-[9px] border border-border bg-surface px-2.5 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:shadow-focus focus:border-primary-soft'
const labelCls = 'text-[9px] text-ink-3'

/**
 * 设置·模型与连接页（ardot 06 实测值）：页头（当前模型+连接数+添加连接）
 * + 当前模型卡（薄荷浅底渐变 logo + 状态点）+ 连接行三态（使用中/未使用/未连接）
 * + 新增/编辑表单（服务商下拉/Base URL/API Key 掩码/模型名/最大 Token/测试连接/保存并启用）
 * + 页脚说明。行点击 = 打开编辑表单（key 掩码 +「已保存」，聚焦整体替换）。
 */
export default function ConnectionPage(): ReactElement {
  const config = useConnectionStore((s) => s.config)
  const error = useConnectionStore((s) => s.error)
  const formOpen = useConnectionStore((s) => s.formOpen)
  const editing = useConnectionStore((s) => s.editing)
  const saving = useConnectionStore((s) => s.saving)
  const testing = useConnectionStore((s) => s.testing)
  const testResult = useConnectionStore((s) => s.testResult)
  const openAdd = useConnectionStore((s) => s.openAdd)
  const openEdit = useConnectionStore((s) => s.openEdit)
  const closeForm = useConnectionStore((s) => s.closeForm)
  const add = useConnectionStore((s) => s.add)
  const update = useConnectionStore((s) => s.update)
  const remove = useConnectionStore((s) => s.remove)
  const test = useConnectionStore((s) => s.test)
  const clearTest = useConnectionStore((s) => s.clearTest)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [keyDirty, setKeyDirty] = useState(false)

  const connections = config?.connections ?? []
  const active = connections.find((c) => c.active) ?? null
  const meta = active ? `当前 ${active.model} · 共 ${connections.length} 个连接` : `共 ${connections.length} 个连接`

  const openAddForm = (): void => {
    setForm(EMPTY_FORM)
    setKeyDirty(false)
    openAdd()
  }

  const openEditForm = (c: ConnectionInfo): void => {
    setForm(formFromConn(c))
    setKeyDirty(false)
    openEdit(c)
  }

  const cancelForm = (): void => {
    setForm(EMPTY_FORM)
    setKeyDirty(false)
    closeForm()
  }

  const patch = (p: Partial<FormState>): void => {
    setForm((f) => ({ ...f, ...p }))
    clearTest() // 输入变化后旧测试结果失效（设计：失败浮红字保留输入，改输入则清除）
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    const input = buildInput(form)
    if (editing) void update(editing.id, input)
    else void add(input)
  }

  const doDelete = async (c: ConnectionInfo): Promise<void> => {
    const label = providerLabel(c.provider)
    if (c.active) {
      if (!window.confirm(`删除当前连接「${label}」？聊天将回退到默认配置。此操作不可恢复。`)) return
    }
    await remove(c.id)
  }

  const onTest = (): void => {
    void test(buildInput(form))
  }

  const keyEditable = !editing || keyDirty
  const canSave = form.model.trim() !== '' && !saving

  return (
    <>
      <header className="shrink-0 flex items-end justify-between">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[17px] leading-none font-semibold text-ink">模型与连接</h1>
          <p className="text-[11px] text-ink-3">{meta}</p>
        </div>
        {formOpen ? (
          <button
            type="button"
            className="flex h-[30px] items-center rounded-pill border border-[#d6e5de] px-(--sp-2) text-[11px] font-medium text-ink-soft cursor-pointer hover:bg-hover-bg active:scale-[0.96]"
            onClick={cancelForm}
          >
            收起表单
          </button>
        ) : (
          <button
            type="button"
            className="flex h-[30px] items-center gap-[5px] rounded-pill border border-[#d6e5de] px-(--sp-2) text-[11px] font-medium text-ink-soft cursor-pointer hover:bg-hover-bg active:scale-[0.96]"
            onClick={openAddForm}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
              <path d="M4.5 1.2v6.6M1.2 4.5h6.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            添加连接
          </button>
        )}
      </header>

      {error !== null && <p className="shrink-0 text-[11px] text-accent-ink">{error}</p>}

      {active !== null && (
        <div className="connection-card shrink-0 flex h-16 items-center gap-2.5 rounded-[14px] border-[1.5px] border-[#bfe5d9] bg-[#f2fcf7] px-(--sp-2)">
          <div className="size-9 shrink-0 rounded-[10px] bg-linear-to-r from-[#70d9b8] to-[#36a382] flex items-center justify-center">
            <span className="text-[15px] font-bold text-white">{providerLabel(active.provider)[0]}</span>
          </div>
          <div className="min-w-0 flex-1 flex flex-col gap-[3px]">
            <span className="truncate text-xs font-semibold text-[#2e5e50]">
              {providerLabel(active.provider)} · {active.model}
            </span>
            <span className="truncate text-[10px] text-meta-mint">
              {hostOf(active)} · {active.check_fail ? '服务未启动' : relTime(active.last_check)}
            </span>
          </div>
          <span className="flex items-center gap-[5px] text-[10px] font-medium text-active-ink">
            <span className={`size-1.5 rounded-pill ${active.last_check !== null ? 'bg-[#4cc29a]' : 'bg-[#dcd5cb]'}`} />
            {active.last_check !== null ? '已连接' : '未连接'}
          </span>
        </div>
      )}
      {active === null && (
        <div className="shrink-0 flex h-16 items-center justify-center rounded-[14px] border border-dashed border-[#e8e0d4] bg-[#fcfaf5] text-[11px] text-ink-3">
          尚未配置连接，添加后即可对话
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
        {connections.map((c) => (
          <div
            key={c.id}
            className={`connection-row group flex h-14 shrink-0 items-center gap-2.5 rounded-[12px] border bg-surface px-2.5 ${
              c.active ? 'border-border-warm' : 'border-border-warm cursor-pointer hover:bg-hover-bg'
            }`}
            onClick={() => {
              if (!c.active) openEditForm(c)
            }}
          >
            <div
              className={`size-7 shrink-0 rounded-lg flex items-center justify-center ${
                c.check_fail ? 'bg-[#f0f5f2]' : 'bg-[#f2efe6]'
              }`}
            >
              <span className="text-xs font-bold text-[#8fa5a0]">{providerLabel(c.provider)[0]}</span>
            </div>
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <span className="truncate text-xs text-ink">
                {providerLabel(c.provider)} · {c.model}
              </span>
              <span className="truncate text-[10px] text-ink-3">
                {hostOf(c)} · {c.check_fail ? '服务未启动' : c.has_key ? '密钥已保存' : '未填密钥'}
              </span>
            </div>
            {c.active ? (
              <span className="h-6 flex items-center rounded-pill bg-selected-bg px-2.5 text-[10px] font-medium text-primary-deep">
                使用中
              </span>
            ) : c.check_fail ? (
              <span className="flex items-center gap-[5px] text-[10px] text-ink-faint">
                <span className="size-1.5 rounded-pill bg-[#dcd5cb]" />
                未连接
              </span>
            ) : (
              <span className="text-[10px] text-ink-faint">未使用</span>
            )}
            <button
              type="button"
              className="size-7 shrink-0 flex items-center justify-center rounded-pill text-ink-3 cursor-pointer hover:bg-hover-bg hover:text-accent-ink"
              title="删除连接"
              aria-label={`删除连接 ${providerLabel(c.provider)}`}
              onClick={(e) => {
                e.stopPropagation()
                void doDelete(c)
              }}
            >
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M2 3.5h8M4.5 3V2h3v1M3 3.5l.6 6.2c0 .4.3.8.7.8h3.4c.4 0 .7-.4.7-.8l.6-6.2M5 5.5v3M7 5.5v3"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {formOpen && (
        <form
          className="connection-form shrink-0 flex flex-col gap-[9px] rounded-[14px] border border-border bg-cream-deep p-(--sp-2)"
          onSubmit={onSubmit}
        >
          <span className="text-[11px] font-semibold text-ink-soft">{editing ? '编辑连接' : '添加连接'}</span>
          <div className="flex gap-2">
            <label className="flex-1 flex flex-col gap-1">
              <span className={labelCls}>服务商</span>
              <select
                className={`${inputCls} cursor-pointer appearance-none`}
                value={form.provider}
                onChange={(e) => patch({ provider: e.target.value })}
              >
                {Object.entries({ deepseek: 'DeepSeek', dashscope: '阿里云百炼', zhipu: '智谱 AI', moonshot: '月之暗面 Kimi' }).map(
                  ([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </label>
            <label className="flex-1 flex flex-col gap-1">
              <span className={labelCls}>Base URL</span>
              <input
                className={inputCls}
                placeholder="留空使用服务商默认"
                value={form.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>API Key</span>
            {keyEditable ? (
              <input
                type="password"
                className={inputCls}
                placeholder={editing ? '输入新 key 整体替换' : 'sk-…'}
                value={form.apiKey}
                autoFocus={editing}
                onChange={(e) => patch({ apiKey: e.target.value })}
              />
            ) : (
              <button
                type="button"
                className={`${inputCls} flex items-center justify-between cursor-pointer`}
                onClick={() => setKeyDirty(true)}
              >
                <span className="truncate text-[11px] text-ink">{editing?.key_masked}</span>
                <span className="shrink-0 text-[9px] text-primary-deep">已保存</span>
              </button>
            )}
          </label>
          <div className="flex gap-2">
            <label className="flex-1 flex flex-col gap-1">
              <span className={labelCls}>模型名</span>
              <input
                className={inputCls}
                placeholder="deepseek-chat / qwen-plus / …"
                value={form.model}
                onChange={(e) => patch({ model: e.target.value })}
              />
            </label>
            <label className="w-[104px] shrink-0 flex flex-col gap-1">
              <span className={labelCls}>最大 Token</span>
              <input
                className={inputCls}
                type="number"
                min={0}
                placeholder="默认"
                value={form.maxTokens}
                onChange={(e) => patch({ maxTokens: e.target.value })}
              />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className={`text-[11px] ${testResult !== null && testResult.ok ? 'text-active-ink' : 'text-accent-ink'}`}>
              {testResult?.message ?? ''}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex h-7 items-center rounded-pill border border-[#e6ded1] bg-surface px-(--sp-2) text-[11px] font-medium text-ink-soft cursor-pointer hover:bg-hover-bg active:scale-[0.96] disabled:opacity-50"
                disabled={testing || !canSave}
                onClick={onTest}
              >
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button
                type="submit"
                className="flex h-7 items-center rounded-pill bg-linear-to-r from-primary to-deep-end px-[14px] text-[11px] font-medium text-white shadow-button cursor-pointer hover:-translate-y-px active:scale-[0.96] disabled:opacity-60"
                disabled={!canSave}
              >
                {saving ? '保存中…' : '保存并启用'}
              </button>
            </div>
          </div>
        </form>
      )}

      <footer className="shrink-0 text-[10px] text-ink-footer">
        密钥存于本机 keychain，不随对话上传 · 兼容 OpenAI 协议
      </footer>
    </>
  )
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/settings/__test__/connectionFormat.test.ts src/renderer/src/pet/settings/__test__/ConnectionPage.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd apps/desktop && pnpm format:check && pnpm typecheck
cd ../.. && git add apps/desktop/src/renderer/src/pet/settings/connectionFormat.ts apps/desktop/src/renderer/src/pet/settings/ConnectionPage.tsx apps/desktop/src/renderer/src/pet/settings/__test__/
git commit -m "feat(connection): 模型与连接页——当前模型卡/行三态/新增编辑表单/测试连接"
```

---

### Task 7: SettingsPanel 启用入口 + SettingsApp 加载 + 文档收尾

**Files:**
- Modify: `apps/desktop/src/renderer/src/pet/settings/SettingsPanel.tsx`（PageId 加 'connection'，nav 启用，三页切换）
- Modify: `apps/desktop/src/renderer/src/pet/settings/SettingsApp.tsx`（挂载加载 config）
- Test: `apps/desktop/src/renderer/src/pet/settings/__test__/SettingsPanel.test.tsx`（断言更新 + 新增切换用例）
- Modify: `CLAUDE.md`（设置面板段更新）

**Interfaces:**
- Consumes: Task 6 `ConnectionPage` 默认导出；Task 5 `useConnectionStore.load`
- Produces: 「模型与连接」导航可用（外观与动作/关于仍禁用）

- [ ] **Step 1: SettingsPanel 接线**

Modify `apps/desktop/src/renderer/src/pet/settings/SettingsPanel.tsx`：

1. import 加 `ConnectionPage`；`type PageId = 'chat' | 'model' | 'connection'`
2. NAV_ITEMS 里「模型与连接」的 `page: null` → `page: 'connection'`
3. 内容区三分支：

```tsx
        {page === 'chat' ? <ChatHistoryPage /> : page === 'model' ? <ModelPage /> : <ConnectionPage />}
```

4. 组件注释更新为「本期「形象管理/模型与连接/对话记录」可用，外观与动作/关于 M3+ 占位禁用」。

- [ ] **Step 2: SettingsApp 挂载加载**

Modify `apps/desktop/src/renderer/src/pet/settings/SettingsApp.tsx`：import `useConnectionStore`，在既有两个 useEffect 后加：

```tsx
  useEffect(() => {
    void useConnectionStore.getState().load()
  }, [])
```

- [ ] **Step 3: 测试更新（先红）**

Modify `apps/desktop/src/renderer/src/pet/settings/__test__/SettingsPanel.test.tsx`：

1. 第一个用例（侧栏五入口）：「模型与连接」断言 `disabled).toBe(true)` 改为：

```ts
    expect((screen.getByRole('button', { name: '模型与连接' }) as HTMLButtonElement).disabled).toBe(false)
```

2. 追加用例：

```tsx
  it('点击「模型与连接」切到连接页', () => {
    useConnectionStore.setState({ config: { active_id: '', connections: [] } })
    render(<SettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: '模型与连接' }))
    expect(screen.getByRole('heading', { name: '模型与连接' })).toBeTruthy()
    expect(screen.getByText('尚未配置连接，添加后即可对话')).toBeTruthy()
  })
```

（imports 加 `useConnectionStore`。）注意：`beforeEach` 里 `useConnectionStore.setState` 默认 config 为 null——ConnectionPage 对 null 安全（`?? []`），但为避免与追加用例串状态，追加用例内先 setState。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pet/settings/__test__/`
Expected: 该目录全部 PASS

- [ ] **Step 5: CLAUDE.md 更新**

Modify `CLAUDE.md` 架构速览 `pet/` 段 settings 描述，`nav 其余项 M3+ 禁用` 改为 `nav 其余项（外观与动作/关于）M3+ 禁用`，并在 `chat/` 描述后补一句 `settings/ 新增模型与连接页（连接增删改/测试连接/保存启用，经 /api/v1/config 注入对话 API、热切换免重启，key 只存本机 JSON 0600）`。

- [ ] **Step 6: 全量验证**

Run: `make test`
Expected: Go vet/test + typecheck + vitest 全绿。若 memory_pressure 吃紧先查再跑（dev 任务内存压力）。

手动冒烟清单（供用户视觉验证，Agent 不代替用户确认）：
1. `make dev` → 右键菜单 → 设置 → 「模型与连接」页打开
2. 添加连接：选 DeepSeek、填 key → 测试连接（绿字/红字）→ 保存并启用 → 当前模型卡更新
3. 桌宠窗口发消息 → 走新配置（观察回复质量/出错文案）
4. 行点击编辑：key 显示掩码 + 已保存 → 保存并启用切换 → 旧连接「未使用」
5. 删除激活连接（二次确认）→ 回退默认
6. 重启 server → 连接列表仍在（JSON 持久化）

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/pet/settings/SettingsPanel.tsx apps/desktop/src/renderer/src/pet/settings/SettingsApp.tsx apps/desktop/src/renderer/src/pet/settings/__test__/SettingsPanel.test.tsx CLAUDE.md
git commit -m "feat(settings): 启用模型与连接导航页并挂载加载"
```

---

## 自审清单（已执行）

1. **Spec 覆盖**：设计图 06 全部元素有落点——页头 meta「当前 X · 共 N 个连接」（Task 6 测试）、添加连接次按钮（Task 6）、当前模型卡渐变 logo+域名+校验时间+状态点（Task 6）、连接行三态+删除（Task 6）、表单五字段+两按钮+页脚（Task 6）、key 掩码 16 个 •+已保存（Task 1 MaskKey/Task 6）、测试连接 loading 与红字保留输入（Task 3/6）、保存并启用激活+旧连接降级（Task 3 Add/Update 恒激活）、切换不打断流式（Task 2 Registry 捕获语义+测试）。README §06 交互补充全部覆盖。M3 验收「切 provider 免重启生效/非法配置拒绝不落盘/test-llm 明确成败」分别在 Task 3 swapActive、Task 3 Validate+Task 4 422、Task 3 Test 文案化。设计图 04 状态与规范（token）沿用既有 tokens.css，9px 等图内新值以任意值落地。
2. **Placeholder 扫描**：无 TBD/TODO；所有代码块为完整实现；「照 Task N」无出现。
3. **类型一致性**：`ConnInput` 字段（provider/base_url/model/api_key/max_tokens/tested/test_ok）在 Task 3 定义、Task 5 前端镜像、Task 6 buildInput 构造一致；`ConnectionOut` 字段（key_masked/has_key/last_check/check_fail/active）Task 3 定义、Task 5 `ConnectionInfo` 镜像、Task 6 消费一致；`ErrDuplicate/ErrNotFound` Task 3 定义、Task 4 errors.Is 引用一致；`llm.New` 签名在 Task 2/3/4 一致；`MaskKey` 16 个 • 在 Task 1/3 测试与前端测试文案一致。

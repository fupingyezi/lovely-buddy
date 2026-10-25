package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"lovelybuddy/server/internal/configstore"
	"lovelybuddy/server/internal/llm"
	"lovelybuddy/server/internal/lovely-agent/model"
)

func newSvc(t *testing.T) (*ConfigService, *configstore.File) {
	t.Helper()
	t.Setenv("LOVELYBUDDY_CONFIG_FILE", filepath.Join(t.TempDir(), "config.json"))
	file, err := configstore.Load()
	if err != nil {
		t.Fatal(err)
	}
	fallback, err := model.New("deepseek", "", "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	return NewConfigService(model.NewRegistry(fallback), file, fallback), file
}

func validInput() ConnInput {
	return ConnInput{Provider: "deepseek", Model: "deepseek-chat", APIKey: "sk-abc", BaseURL: "", MaxTokens: 0}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*TestInput)
		bad  bool
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
	// 出参不得携带 key 明文，只给掩码
	if state.Connections[0].KeyMasked == "" || !state.Connections[0].HasKey {
		t.Fatalf("掩码/标志异常: %+v", state.Connections[0])
	}
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
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\ndata: [DONE]\n\n"))
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

// DeepSeek 401 真实返回纯文本（如 "Authentication Fails (governor)"），
// go-openai 解析失败走 *RequestError——文案仍须按状态码映射，不裸透 JSON 解析噪音。
func TestTestConnectionPlain401(t *testing.T) {
	svc, _ := newSvc(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Authentication Fails (governor)", http.StatusUnauthorized)
	}))
	defer srv.Close()
	res := svc.Test(TestInput{Provider: "deepseek", Model: "m", APIKey: "bad", BaseURL: srv.URL})
	if res.OK || res.Error != "API Key 无效（401）" {
		t.Fatalf("期望 401 中文文案，得 %+v", res)
	}
}

// 编辑表单 key 未动（api_key 空）：按 id 回退存储 key（前端拿不到明文，只能后端回退）。
// 模型名已改（m2 ≠ 存储的 m）——回退按 id 而非模型匹配。
func TestTestConnectionFallsBackToStoredKey(t *testing.T) {
	svc, _ := newSvc(t)
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\ndata: [DONE]\n\n"))
	}))
	defer srv.Close()
	st, err := svc.Add(ConnInput{Provider: "deepseek", Model: "m", APIKey: "sk-real", BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	res := svc.Test(TestInput{Provider: "deepseek", Model: "m2", BaseURL: srv.URL, ID: st.ActiveID})
	if !res.OK {
		t.Fatalf("期望成功，得 %+v", res)
	}
	if gotAuth != "Bearer sk-real" {
		t.Fatalf("应用存储 key，得 %q", gotAuth)
	}
}

// 回退条件不满足（id 未知或厂商/地址已改）且 key 空 → 空 Bearer → 上游 401 中文文案。
func TestTestConnectionNoKeyFallback(t *testing.T) {
	svc, _ := newSvc(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Authentication Fails (governor)", http.StatusUnauthorized)
	}))
	defer srv.Close()
	res := svc.Test(TestInput{Provider: "deepseek", Model: "m", BaseURL: srv.URL})
	if res.OK || res.Error != "API Key 无效（401）" {
		t.Fatalf("期望 401 中文文案，得 %+v", res)
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

// 重启恢复：已保存的激活 forward 连接必须在启动时重新生效（不能走 llm.New 而被丢弃）。
func TestApplyActiveRestoresForward(t *testing.T) {
	svc, file := newSvc(t)
	c := file.Add(configstore.Connection{Provider: "forward", Forward: json.RawMessage(fwdSpec)})
	file.ActiveID = c.ID
	if err := file.Save(); err != nil {
		t.Fatal(err)
	}
	if err := svc.ApplyActive(); err != nil {
		t.Fatal(err)
	}
	p := svc.reg.Current()
	if p == nil {
		t.Fatal("ApplyActive 后注册表不应为空")
	}
	if _, ok := p.(*llm.ForwardProvider); !ok {
		t.Fatalf("重启后应恢复 ForwardProvider: %T", p)
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
	if !ok.OK || ok.LatencyMS == nil || *ok.LatencyMS < 0 {
		t.Fatalf("探活应成功且带耗时: %+v", ok)
	}
	bad := svc.Test(TestInput{Provider: "forward", Forward: json.RawMessage(fmt.Sprintf(
		`{"request":{"url":"%s/x","method":"GET"},"response":{"type":"text"},"probe":{"url":"%s/status","expect_status":201}}`,
		probe.URL, probe.URL))})
	if bad.OK || !strings.Contains(bad.Error, "201") {
		t.Fatalf("期望 201 应失败: %+v", bad)
	}
	nop := svc.Test(TestInput{Provider: "forward", Forward: json.RawMessage(fwdSpec)})
	if !nop.OK || nop.LatencyMS != nil {
		t.Fatalf("无 probe 应直接 OK 且无耗时: %+v", nop)
	}
}

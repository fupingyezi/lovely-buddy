package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lovelybuddy/server/internal/configstore"
	"lovelybuddy/server/internal/lovely-agent/model"
	"lovelybuddy/server/internal/service"
)

const testToken = "test-token"

// scriptedLLM 与 service 包测试的假 provider 同构（server 包本地一份，避免导出测试工具）。
type scriptedLLM struct{}

func (scriptedLLM) StreamChat(_ context.Context, _ []model.Message) <-chan model.StreamEvent {
	ch := make(chan model.StreamEvent)
	go func() {
		defer close(ch)
		ch <- model.StreamEvent{Delta: "你好"}
		ch <- model.StreamEvent{Delta: "[motion:happy]呀"}
	}()
	return ch
}
func (scriptedLLM) Configured() bool { return true }
func (scriptedLLM) KeyEnv() string   { return "DEEPSEEK_API_KEY" }

// newTestServer 组装引擎（无 DB），返回测试客户端与模型根目录。
func newTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	reg := model.NewRegistry(scriptedLLM{})
	chats := service.NewChatService(service.NewMemStore(), reg, root)
	file := &configstore.File{}
	cfgSvc := service.NewConfigService(reg, file, scriptedLLM{})
	personaSvc := service.NewPersonaService(file)
	srv := New("127.0.0.1:0", testToken, nil, root, chats, cfgSvc, personaSvc)
	ts := httptest.NewServer(srv.Handler)
	t.Cleanup(ts.Close)
	return ts, root
}

func doJSON(t *testing.T, method, url, token string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, url, &buf)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&m)
	return resp, m
}

func makeTestZip(t *testing.T) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range map[string]string{
		"m/avatar.json":   `{"name":"测试形象","actions":{"sad":{"expression":"F_SAD"}}}`,
		"m/m.model3.json": `{"Version":3}`,
	} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(content))
	}
	_ = zw.Close()
	p := filepath.Join(t.TempDir(), "t.zip")
	if err := os.WriteFile(p, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAssetsAuth(t *testing.T) {
	ts, _ := newTestServer(t)
	resp, _ := doJSON(t, http.MethodGet, ts.URL+"/api/v1/assets", "", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("无 token 应 401, got %d", resp.StatusCode)
	}
}

func TestAssetsImportListDelete(t *testing.T) {
	ts, root := newTestServer(t)
	zipPath := makeTestZip(t)

	// 导入本地 zip
	resp, m := doJSON(t, http.MethodPost, ts.URL+"/api/v1/assets/import", testToken,
		map[string]any{"source": map[string]string{"type": "path", "value": zipPath}})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("导入应 200, got %d %v", resp.StatusCode, m)
	}
	av, _ := m["avatar"].(map[string]any)
	if av["slug"] != "t-zip" || av["name"] != "测试形象" {
		t.Fatalf("avatar 不符: %v", av)
	}
	act, ok := av["actions"].(map[string]any)
	if !ok {
		t.Fatalf("导入响应应含 actions: %v", av)
	}
	sad, ok := act["sad"].(map[string]any)
	if !ok || sad["expression"] != "F_SAD" {
		t.Fatalf("导入响应应透传 actions: %v", av)
	}

	// 列表含新形象，且 actions 一并透传
	resp, m = doJSON(t, http.MethodGet, ts.URL+"/api/v1/assets", testToken, nil)
	avatars, _ := m["avatars"].([]any)
	if resp.StatusCode != http.StatusOK || len(avatars) != 1 {
		t.Fatalf("列表不符: %d %v", resp.StatusCode, m)
	}
	first, _ := avatars[0].(map[string]any)
	firstAct, ok := first["actions"].(map[string]any)
	if !ok {
		t.Fatalf("列表响应应透传 actions: %v", avatars[0])
	}
	firstSad, ok := firstAct["sad"].(map[string]any)
	if !ok || firstSad["expression"] != "F_SAD" {
		t.Fatalf("列表 actions 不符: %v", firstAct)
	}

	// 恶意 zip 经 API 被拒（422）
	evil := filepath.Join(t.TempDir(), "evil.zip")
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("../../evil.txt")
	_, _ = w.Write([]byte("x"))
	_ = zw.Close()
	_ = os.WriteFile(evil, buf.Bytes(), 0o644)
	resp, m = doJSON(t, http.MethodPost, ts.URL+"/api/v1/assets/import", testToken,
		map[string]any{"source": map[string]string{"type": "path", "value": evil}})
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("恶意 zip 应 422, got %d %v", resp.StatusCode, m)
	}

	// 删除 → 列表空；再删非法 slug → 400
	resp, _ = doJSON(t, http.MethodDelete, ts.URL+"/api/v1/assets/t-zip", testToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("删除应 200, got %d", resp.StatusCode)
	}
	resp, m = doJSON(t, http.MethodGet, ts.URL+"/api/v1/assets", testToken, nil)
	if avatars, _ := m["avatars"].([]any); len(avatars) != 0 {
		t.Fatalf("删除后应空: %v", m)
	}
	// 非法 slug（点开头）→ 400；含 / 的穿越形（如 ..%2Fx）在 gin 路由层已被 404 拦截
	resp, _ = doJSON(t, http.MethodDelete, ts.URL+"/api/v1/assets/..x", testToken, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("非法 slug 应 400, got %d", resp.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(root, "t-zip")); !os.IsNotExist(err) {
		t.Fatal("形象目录应已删除")
	}
}

func TestPing(t *testing.T) {
	ts, _ := newTestServer(t)
	resp, m := doJSON(t, http.MethodGet, ts.URL+"/api/v1/ping", testToken, nil)
	if resp.StatusCode != http.StatusOK || m["pong"] != true {
		t.Fatalf("ping 应 200 pong: %d %v", resp.StatusCode, m)
	}
}

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

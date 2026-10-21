package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

const testToken = "test-token"

// newTestServer 组装引擎（无 DB，仅 assets 路由），返回测试客户端与模型根目录。
func newTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	srv := New("127.0.0.1:0", testToken, nil, root)
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
		"m/avatar.json":   `{"name":"测试形象"}`,
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

	// 列表含新形象
	resp, m = doJSON(t, http.MethodGet, ts.URL+"/api/v1/assets", testToken, nil)
	avatars, _ := m["avatars"].([]any)
	if resp.StatusCode != http.StatusOK || len(avatars) != 1 {
		t.Fatalf("列表不符: %d %v", resp.StatusCode, m)
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

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

func doConfigJSON(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAddAndStateRoundtrip(t *testing.T) {
	r := newConfigRouter(t)
	w := doConfigJSON(t, r, http.MethodPost, "/config/connections",
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
	w2 := doConfigJSON(t, r, http.MethodPost, "/config/connections",
		`{"provider":"nope","model":"m","api_key":"k"}`)
	if w2.Code != http.StatusUnprocessableEntity {
		t.Fatalf("非法配置应 422，得 %d", w2.Code)
	}
	w3 := doConfigJSON(t, r, http.MethodGet, "/config", "")
	if w3.Code != http.StatusOK || !strings.Contains(w3.Body.String(), `"connections":[{`) {
		t.Fatalf("422 后配置不应变化: %s", w3.Body.String())
	}
}

func TestUpdateNotFoundAndKeepKey(t *testing.T) {
	r := newConfigRouter(t)
	doConfigJSON(t, r, http.MethodPost, "/config/connections", `{"provider":"deepseek","model":"m","api_key":"k1"}`)
	w := doConfigJSON(t, r, http.MethodPut, "/config/connections/ghost", `{"provider":"deepseek","model":"m"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("未知 id 应 404，得 %d", w.Code)
	}
	w2 := doConfigJSON(t, r, http.MethodGet, "/config", "")
	var st service.ConfigState
	_ = json.Unmarshal(w2.Body.Bytes(), &st)
	id := st.Connections[0].ID
	w3 := doConfigJSON(t, r, http.MethodPut, "/config/connections/"+id, `{"provider":"deepseek","model":"deepseek-reasoner"}`)
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
	w := doConfigJSON(t, r, http.MethodPost, "/config/connections", `{"provider":"deepseek","model":"m","api_key":"k1"}`)
	var st service.ConfigState
	_ = json.Unmarshal(w.Body.Bytes(), &st)
	id := st.Connections[0].ID
	w2 := doConfigJSON(t, r, http.MethodDelete, "/config/connections/"+id, "")
	if w2.Code != http.StatusOK {
		t.Fatalf("Delete = %d", w2.Code)
	}
	var st2 service.ConfigState
	_ = json.Unmarshal(w2.Body.Bytes(), &st2)
	if st2.ActiveID != "" {
		t.Fatalf("删光后 active 应为空: %+v", st2)
	}
	// 校验失败 422
	w3 := doConfigJSON(t, r, http.MethodPost, "/config/test", `{"provider":"deepseek","model":"  "}`)
	if w3.Code != http.StatusUnprocessableEntity {
		t.Fatalf("Test 校验失败应 422，得 %d", w3.Code)
	}
}

package middleware_test

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/middleware"
)

func TestRedactQuery(t *testing.T) {
	cases := map[string]string{
		"token=abc123":               "token=REDACTED",
		"a=1&token=abc123&b=2":       "a=1&token=REDACTED&b=2",
		"token=abc&other_token=x":    "token=REDACTED&other_token=x",
		"":                           "",
	}
	for in, want := range cases {
		if got := middleware.RedactQuery(in); got != want {
			t.Errorf("RedactQuery(%q) = %q，期望 %q", in, got, want)
		}
	}
}

func TestAccessLogRedactsTokenInURL(t *testing.T) {
	// 捕获 slog 输出，验证访问日志中的 token 被脱敏
	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.AccessLog())
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x?token=supersecret", nil))

	out := buf.String()
	if strings.Contains(out, "supersecret") {
		t.Fatalf("日志泄露了 token：\n%s", out)
	}
	if !strings.Contains(out, "token=REDACTED") {
		t.Fatalf("日志未出现脱敏标记：\n%s", out)
	}
}

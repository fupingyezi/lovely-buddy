package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"skyi/server/internal/middleware"
)

func newTokenRouter(token string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/secret", middleware.Token(token), func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})
	return r
}

func TestTokenBearerAuth(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/secret", nil)
	req.Header.Set("Authorization", "Bearer s3cret")

	newTokenRouter("s3cret").ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("期望 200，得到 %d", w.Code)
	}
}

func TestTokenQueryAuth(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/secret?token=s3cret", nil)

	newTokenRouter("s3cret").ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("期望 200，得到 %d", w.Code)
	}
}

func TestTokenRejected(t *testing.T) {
	cases := map[string]*http.Request{
		"无 token":        httptest.NewRequest(http.MethodGet, "/secret", nil),
		"错误 token":      httptest.NewRequest(http.MethodGet, "/secret?token=wrong", nil),
		"Bearer 头错误":    httptest.NewRequest(http.MethodGet, "/secret", nil),
	}
	cases["Bearer 头错误"].Header.Set("Authorization", "Bearer wrong")

	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			w := httptest.NewRecorder()
			newTokenRouter("s3cret").ServeHTTP(w, req)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("期望 401，得到 %d", w.Code)
			}
		})
	}
}

func TestTokenEmptyAllows(t *testing.T) {
	// 未配置 token 时放行（纯本机开发场景）
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/secret", nil)

	newTokenRouter("").ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("期望 200，得到 %d", w.Code)
	}
}

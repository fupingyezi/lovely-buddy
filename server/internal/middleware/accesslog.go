package middleware

import (
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// AccessLog 基于 slog 的访问日志；query 中的 token 必须脱敏，禁止泄露进日志。
func AccessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		path := c.Request.URL.Path
		if raw := c.Request.URL.RawQuery; raw != "" {
			path += "?" + redactQuery(raw)
		}
		slog.Info("http",
			"method", c.Request.Method,
			"path", path,
			"status", c.Writer.Status(),
			"dur", time.Since(start).Round(time.Microsecond).String(),
		)
	}
}

func redactQuery(raw string) string {
	parts := strings.Split(raw, "&")
	for i, p := range parts {
		if strings.HasPrefix(p, "token=") {
			parts[i] = "token=REDACTED"
		}
	}
	return strings.Join(parts, "&")
}

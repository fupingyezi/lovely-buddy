package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// 允许的来源：dev 模式 Vite（localhost:5173）与打包后 Electron 渲染页（file://，Origin 可能为 file:// 或 null）。
// 服务只绑 127.0.0.1 且 /api 要求 token，放宽 Origin 的代价有限。
var allowedOrigins = map[string]bool{
	"http://localhost:5173": true,
	"http://127.0.0.1:5173": true,
	"file://":               true,
	"null":                  true,
}

func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && allowedOrigins[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

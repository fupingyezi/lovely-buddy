package middleware

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Token 校验 Authorization: Bearer <token> 或 ?token=<token>（WebSocket 只能走 query）。
// token 为空时放行——仅限未配置 token 的纯本机开发场景。
func Token(token string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if token == "" {
			c.Next()
			return
		}
		provided := ""
		if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
			provided = strings.TrimPrefix(h, "Bearer ")
		} else {
			provided = c.Query("token")
		}
		if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}

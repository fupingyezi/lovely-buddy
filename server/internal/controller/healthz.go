// Package controller HTTP 接口层：只做参数解析/校验/状态码/响应写出。
// 业务逻辑在 internal/service 与域包（assets），数据访问在 internal/dao。
package controller

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Version 供 /healthz 与托盘状态展示（自 server 包迁入，避免 controller→server 反向依赖）。
const Version = "0.1.0-dev"

// NewHealthz /healthz：健康探测（公开路由，wait-on 与状态展示用，不含敏感信息）。
// pool 为 nil（如测试）时 db 报 error——原实现会 nil panic，这里顺手兜住（行为微修，可接受）。
func NewHealthz(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		dbStatus := "error"
		if pool != nil {
			pingCtx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
			defer cancel()
			if err := pool.Ping(pingCtx); err == nil {
				dbStatus = "ok"
			}
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "db": dbStatus, "version": Version})
	}
}

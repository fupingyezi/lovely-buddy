package server

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"lovelybuddy/server/internal/assets"
	"lovelybuddy/server/internal/middleware"
)

// Version 供 /healthz 与托盘状态展示。
const Version = "0.1.0-dev"

// New 组装 gin 引擎与路由。modelDir 为模型根目录（形象库）。
// /healthz 公开（wait-on 与健康探测用，不含敏感信息）；/api/v1 全部要求 token。
func New(addr, token string, pool *pgxpool.Pool, modelDir string) *http.Server {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(middleware.AccessLog(), gin.Recovery(), middleware.CORS())

	r.GET("/healthz", func(c *gin.Context) {
		dbStatus := "ok"
		pingCtx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(pingCtx); err != nil {
			dbStatus = "error"
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "db": dbStatus, "version": Version})
	})

	api := r.Group("/api/v1", middleware.Token(token))
	{
		api.GET("/ping", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"pong": true}) })
		api.GET("/assets", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"avatars": assets.Detect(modelDir)})
		})
	}

	return &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
}

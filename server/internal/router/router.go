// Package router 路由装配：只声明「路径 → controller」与鉴权分组，不写业务。
// /healthz 公开；/api/v1 全部 token 鉴权。
package router

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"lovelybuddy/server/internal/controller"
	"lovelybuddy/server/internal/middleware"
)

// Register 注册全部路由（在 engine 挂完全局中间件之后调用）。
func Register(r *gin.Engine, pool *pgxpool.Pool, token, modelDir string) {
	r.GET("/healthz", controller.NewHealthz(pool))

	api := r.Group("/api/v1", middleware.Token(token))
	assetsCtl := controller.NewAssets(modelDir)
	api.GET("/ping", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"pong": true}) })
	api.GET("/assets", assetsCtl.List)
	api.POST("/assets/import", assetsCtl.Import)
	api.DELETE("/assets/:slug", assetsCtl.Delete)
}

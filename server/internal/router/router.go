// Package router 路由装配：只声明「路径 → controller」与鉴权分组，不写业务。
// /healthz 公开；/api/v1 全部 token 鉴权。
package router

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"lovelybuddy/server/internal/controller"
	"lovelybuddy/server/internal/middleware"
	"lovelybuddy/server/internal/service"
)

// Register 注册全部路由（在 engine 挂完全局中间件之后调用）。
// chats 由 main 组装传入（nil 时 chat 接口返回 503）。
func Register(r *gin.Engine, pool *pgxpool.Pool, token, modelDir string, chats *service.ChatService) {
	r.GET("/healthz", controller.NewHealthz(pool))

	api := r.Group("/api/v1", middleware.Token(token))
	assetsCtl := controller.NewAssets(modelDir)
	api.GET("/ping", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"pong": true}) })
	api.GET("/assets", assetsCtl.List)
	api.POST("/assets/import", assetsCtl.Import)
	api.DELETE("/assets/:slug", assetsCtl.Delete)
	chatCtl := controller.NewChat(chats)
	api.POST("/chat", chatCtl.Send)
	api.GET("/history", chatCtl.History)
	api.DELETE("/history", chatCtl.Clear)
}

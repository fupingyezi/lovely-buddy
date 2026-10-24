// server 包只做组装：engine + 全局中间件 + 路由注册。
// 具体路由在 internal/router，接口处理在 internal/controller，
// 业务在 internal/service 与域包（assets），数据访问在 internal/dao。
package server

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"lovelybuddy/server/internal/middleware"
	"lovelybuddy/server/internal/router"
	"lovelybuddy/server/internal/service"
)

// New 组装 HTTP 服务。pool 可为 nil（healthz 将报 db error）；chats 为聊天服务；
// cfgSvc 为模型与连接配置服务（main 恒传非 nil）。
func New(addr, token string, pool *pgxpool.Pool, modelDir string, chats *service.ChatService, cfgSvc *service.ConfigService) *http.Server {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(middleware.AccessLog(), gin.Recovery(), middleware.CORS())
	router.Register(r, pool, token, modelDir, chats, cfgSvc)
	return &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
}

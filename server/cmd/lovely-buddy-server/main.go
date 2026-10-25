package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"lovelybuddy/server/internal/config"
	"lovelybuddy/server/internal/configstore"
	"lovelybuddy/server/internal/controller"
	"lovelybuddy/server/internal/dao"
	"lovelybuddy/server/internal/db"
	"lovelybuddy/server/internal/llm"
	"lovelybuddy/server/internal/server"
	"lovelybuddy/server/internal/service"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	var (
		addr     = flag.String("addr", envOr("LOVELYBUDDY_ADDR", "127.0.0.1:8740"), "监听地址（只应绑本机）")
		token    = flag.String("token", envOr("LOVELYBUDDY_TOKEN", ""), "鉴权 token（空则回退 LOVELYBUDDY_DEV_TOKEN）")
		dsn      = flag.String("dsn", envOr("LOVELYBUDDY_DB_DSN", "postgres://lovelybuddy:lovelybuddy@127.0.0.1:5433/lovelybuddy?sslmode=disable"), "PostgreSQL DSN")
		modelDir = flag.String("model-dir", envOr("LOVELYBUDDY_MODEL_DIR", "../model"), "Live2D 模型根目录（dev 默认仓库 model/）")
	)
	flag.Parse()
	if *token == "" {
		*token = os.Getenv("LOVELYBUDDY_DEV_TOKEN")
	}

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, *dsn)
	if err != nil {
		slog.Error("连接数据库失败（docker compose up -d 了吗？）", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := db.Migrate(*dsn); err != nil {
		slog.Error("数据库迁移失败", "err", err)
		os.Exit(1)
	}

	cfg := config.Load()
	fallback, err := llm.Resolve(cfg.Chat.Provider, cfg.Chat.Model, cfg.Chat.BaseURL)
	if err != nil {
		slog.Error("对话厂商配置无效", "err", err)
		os.Exit(1)
	}
	reg := llm.NewRegistry(fallback)

	// M3 模型与连接：界面注入优先（有已保存连接时 env/.env 不参与）
	file, err := configstore.Load()
	if err != nil {
		slog.Warn("模型与连接配置读取失败，忽略", "err", err)
		file = &configstore.File{}
	}
	cfgSvc := service.NewConfigService(reg, file, fallback)
	// 启动恢复激活连接（含 forward）：与运行期保存/启用的热切换同一路径。
	if err := cfgSvc.ApplyActive(); err != nil {
		slog.Warn("已保存的连接无效，回退环境默认", "err", err)
	}

	chats := service.NewChatService(dao.NewChat(pool), reg, *modelDir)
	srv := server.New(*addr, *token, pool, *modelDir, chats, cfgSvc)
	go func() {
		slog.Info("lovely-buddy-server 已启动", "addr", *addr, "version", controller.Version)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	slog.Info("正在退出…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

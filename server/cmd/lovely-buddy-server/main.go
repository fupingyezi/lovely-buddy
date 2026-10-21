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

	"lovelybuddy/server/internal/db"
	"lovelybuddy/server/internal/server"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	var (
		addr  = flag.String("addr", envOr("LOVELYBUDDY_ADDR", "127.0.0.1:8740"), "监听地址（只应绑本机）")
		token = flag.String("token", envOr("LOVELYBUDDY_TOKEN", ""), "鉴权 token（空则回退 LOVELYBUDDY_DEV_TOKEN）")
		dsn   = flag.String("dsn", envOr("LOVELYBUDDY_DB_DSN", "postgres://lovelybuddy:lovelybuddy@127.0.0.1:5433/lovelybuddy?sslmode=disable"), "PostgreSQL DSN")
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

	srv := server.New(*addr, *token, pool)
	go func() {
		slog.Info("lovely-buddy-server 已启动", "addr", *addr, "version", server.Version)
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

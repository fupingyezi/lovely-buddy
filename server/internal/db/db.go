package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect 建立 pgx 连接池。数据库可能仍在启动（docker compose 首次拉镜像较慢），
// 20 秒内以 1 秒间隔重试 Ping。
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 4

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}

	deadline := time.Now().Add(20 * time.Second)
	for {
		pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		err = pool.Ping(pingCtx)
		cancel()
		if err == nil {
			return pool, nil
		}
		if time.Now().After(deadline) {
			pool.Close()
			return nil, err
		}
		time.Sleep(time.Second)
	}
}

package dao

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"lovelybuddy/server/internal/db"
)

// testPool 连 dev 库（make db）；不可达则跳过——避免强制依赖 DB 的单测。
// 只动本测试自建的 session 行，结束按 id 清理（messages 级联），不碰 dev 既有数据。
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("LOVELYBUDDY_DB_DSN")
	if dsn == "" {
		dsn = "postgres://lovelybuddy:lovelybuddy@127.0.0.1:5433/lovelybuddy?sslmode=disable"
	}
	pool, err := db.Connect(context.Background(), dsn)
	if err != nil {
		t.Skip("需要 pgvector（make db）:", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestChatDAOAppendHistory(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	d := NewChat(pool)

	// 自建会话行（不走 DefaultSession——它会复用 dev 库既有会话）
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO sessions (title) VALUES ('dao-test') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, id)
	})

	if err := d.Append(ctx, id, "user", "你好", ""); err != nil {
		t.Fatal(err)
	}
	if err := d.Append(ctx, id, "assistant", "你好呀", "happy"); err != nil {
		t.Fatal(err) // Append 不做剥离（service 负责），这里只验存储
	}
	msgs, err := d.History(ctx, id, 10)
	if err != nil || len(msgs) != 2 {
		t.Fatalf("len=%d err=%v", len(msgs), err)
	}
	if msgs[0].Role != "user" || msgs[1].Motion != "happy" {
		t.Fatalf("字段不符: %+v", msgs)
	}
	limited, _ := d.History(ctx, id, 1)
	if len(limited) != 1 || limited[0].Content != "你好呀" {
		t.Fatalf("limit 取最近一条升序: %+v", limited)
	}
}

func TestChatDAOClear(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	d := NewChat(pool)

	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO sessions (title) VALUES ('dao-clear-test') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, id) })

	if err := d.Append(ctx, id, "user", "你好", ""); err != nil {
		t.Fatal(err)
	}
	if err := d.Append(ctx, id, "assistant", "你好呀", ""); err != nil {
		t.Fatal(err)
	}
	if err := d.Clear(ctx, id); err != nil {
		t.Fatal(err)
	}
	if msgs, err := d.History(ctx, id, 10); err != nil || len(msgs) != 0 {
		t.Fatalf("清空后应无消息: %v %+v", err, msgs)
	}
}

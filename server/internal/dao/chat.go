// Package dao 数据访问层：只写 SQL 与行映射，不含业务规则，
// 不 import gin / service / controller（依赖最底层）。
package dao

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Message 一条已落库消息（Content 为剥离 [motion:] 标签后的干净文本，剥离在 service 做）。
// JSON tag 即 /api/v1/history 的 messages 元素线上格式。
type Message struct {
	Role      string    `json:"role"` // user | assistant
	Content   string    `json:"content"`
	Motion    string    `json:"motion,omitempty"` // assistant 最后识别的意图，可空
	CreatedAt time.Time `json:"created_at"`
}

// ChatDAO 会话与消息的 Postgres 实现（表结构见 migrations/000001_init.up.sql）。
// 方法集与 service.ChatStore 一致，直接满足该接口。
type ChatDAO struct{ pool *pgxpool.Pool }

func NewChat(pool *pgxpool.Pool) *ChatDAO { return &ChatDAO{pool: pool} }

// DefaultSession 取最新会话，没有则创建（M2 单会话模型，title 固定）。
func (d *ChatDAO) DefaultSession(ctx context.Context) (string, error) {
	var id string
	err := d.pool.QueryRow(ctx, `SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1`).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := d.pool.QueryRow(ctx,
			`INSERT INTO sessions (title) VALUES ('AI桌宠对话') RETURNING id`).Scan(&id); err != nil {
			return "", err
		}
		return id, nil
	}
	if err != nil {
		return "", err
	}
	return id, nil
}

// Append 写一条消息（motion 空串落 NULL）。
func (d *ChatDAO) Append(ctx context.Context, sessionID, role, content, motion string) error {
	_, err := d.pool.Exec(ctx,
		`INSERT INTO messages (session_id, role, content, motion) VALUES ($1, $2, $3, NULLIF($4, ''))`,
		sessionID, role, content, motion)
	return err
}

// History 最近 limit 条，按时间（id）升序返回。
func (d *ChatDAO) History(ctx context.Context, sessionID string, limit int) ([]Message, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT role, content, COALESCE(motion, ''), created_at FROM (
			SELECT * FROM messages WHERE session_id = $1 ORDER BY id DESC LIMIT $2
		) t ORDER BY id ASC`, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.Role, &m.Content, &m.Motion, &m.CreatedAt); err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}

// Clear 清空某会话全部消息（保留会话行，单会话模型会话不断档）。
func (d *ChatDAO) Clear(ctx context.Context, sessionID string) error {
	_, err := d.pool.Exec(ctx, `DELETE FROM messages WHERE session_id = $1`, sessionID)
	return err
}

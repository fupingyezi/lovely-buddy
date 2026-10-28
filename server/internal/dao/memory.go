package dao

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Memory 一条长期记忆（/api/v1/memories 元素线上格式）。
type Memory struct {
	ID        int64     `json:"id"`
	Type      string    `json:"type"` // 偏好 | 事实 | 习惯
	Content   string    `json:"content"`
	Source    string    `json:"source"` // manual；M5 抽取管线写 auto
	CreatedAt time.Time `json:"created_at"`
}

// MemoryDAO 长期记忆的 Postgres 实现（表结构见迁移 000002）。
// 返回 dao.Memory；[]dao.Memory ≠ []memory.Item（Go 切片不协变），
// 由 service 的适配器转换后满足 lovely-agent/memory.Store。
type MemoryDAO struct{ pool *pgxpool.Pool }

func NewMemory(pool *pgxpool.Pool) *MemoryDAO { return &MemoryDAO{pool: pool} }

// List 记忆列表：q 空=全部，非空=内容或类型 ILIKE 模糊；按创建时间倒序，最多 limit 条。
func (d *MemoryDAO) List(ctx context.Context, q string, limit int) ([]Memory, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT id, type, content, source, created_at FROM memories
		WHERE $1 = '' OR content ILIKE '%' || $1 || '%' OR type ILIKE '%' || $1 || '%'
		ORDER BY created_at DESC, id DESC LIMIT $2`, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMemories(rows)
}

// Add 新增记忆，返回落库行（含生成 id）。
func (d *MemoryDAO) Add(ctx context.Context, typ, content, source string) (Memory, error) {
	var m Memory
	err := d.pool.QueryRow(ctx, `
		INSERT INTO memories (type, content, source) VALUES ($1, $2, $3)
		RETURNING id, type, content, source, created_at`, typ, content, source).
		Scan(&m.ID, &m.Type, &m.Content, &m.Source, &m.CreatedAt)
	return m, err
}

// Delete 按 id 删除；不存在返回 false。
func (d *MemoryDAO) Delete(ctx context.Context, id int64) (bool, error) {
	tag, err := d.pool.Exec(ctx, `DELETE FROM memories WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Count 记忆总数。
func (d *MemoryDAO) Count(ctx context.Context) (int, error) {
	var n int
	err := d.pool.QueryRow(ctx, `SELECT COUNT(*) FROM memories`).Scan(&n)
	return n, err
}

// Recent 最近 limit 条，按时间升序（聊天全量注入的读取顺序）。
func (d *MemoryDAO) Recent(ctx context.Context, limit int) ([]Memory, error) {
	rows, err := d.pool.Query(ctx, `
		SELECT id, type, content, source, created_at FROM (
			SELECT * FROM memories ORDER BY created_at DESC, id DESC LIMIT $1
		) t ORDER BY created_at ASC, id ASC`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMemories(rows)
}

func scanMemories(rows pgx.Rows) ([]Memory, error) {
	var out []Memory
	for rows.Next() {
		var m Memory
		if err := rows.Scan(&m.ID, &m.Type, &m.Content, &m.Source, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Package memory 记忆管理：条目模型、存储抽象、检索注入与记忆段组装（M5 抽取管线也归本包）。
// harness 不 import dao/db/service——Store 的 pgvector 实现经 DAO 由 service 注入。
// 单脑原则：记忆条目是记录不是推理状态——推理状态只在接入端大脑（forward 对端 / 模型厂商）。
package memory

import (
	"context"
	"time"

	"lovelybuddy/server/internal/lovely-agent/model"
)

// Item 一条记忆（接口层形态，与 dao.Memory 字段一致；harness 不 import dao）。
type Item struct {
	ID        int64     `json:"id"`
	Type      string    `json:"type"` // 偏好 | 事实 | 习惯
	Content   string    `json:"content"`
	Source    string    `json:"source"` // manual；M5 抽取管线写 auto
	CreatedAt time.Time `json:"created_at"`
}

// Store 存储抽象：管理页 CRUD 与注入读取。
type Store interface {
	List(ctx context.Context, q string, limit int) ([]Item, error)
	Add(ctx context.Context, typ, content, source string) (Item, error)
	Delete(ctx context.Context, id int64) (bool, error)
	Count(ctx context.Context) (int, error)
	Recent(ctx context.Context, limit int) ([]Item, error)
}

// Memory 对话链路视角的记忆能力（harness 契约）。
type Memory interface {
	// Retrieve 检索注入：以最新用户输入为 query 取 topK 条。
	// 本版本实现为全量注入（Recent topK，忽略 query 语义）；M5 换 embedding top-K 语义检索。
	Retrieve(ctx context.Context, query string, topK int) ([]Item, error)
	// Remember 触发抽取回写（M5：对话完成 → 抽取 → sha256 去重 → 嵌入 → 回写）。
	// 本版本为空操作——记忆能力缺席不阻断对话。
	Remember(ctx context.Context, sessionID string, msgs []model.Message)
}

// Noop 零依赖空实现：检索空、回写空（service 未注入时的兜底）。
type Noop struct{}

func (Noop) Retrieve(context.Context, string, int) ([]Item, error) { return nil, nil }
func (Noop) Remember(context.Context, string, []model.Message)     {}

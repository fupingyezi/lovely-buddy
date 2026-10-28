package service

import (
	"context"
	"errors"
	"strings"

	"lovelybuddy/server/internal/dao"
	"lovelybuddy/server/internal/lovely-agent/memory"
	"lovelybuddy/server/internal/lovely-agent/model"
)

// ErrMemoryLimit 记忆数量达到上限。
var ErrMemoryLimit = errors.New("记忆数量已达上限")

// ErrMemoryNotFound 记忆不存在（区别于连接的 ErrNotFound）。
var ErrMemoryNotFound = errors.New("记忆不存在")

// ErrMemoryTypeInvalid 记忆类型不在白名单（偏好/事实/习惯）。
var ErrMemoryTypeInvalid = errors.New("记忆类型无效（偏好/事实/习惯）")

// ErrMemoryContentEmpty 记忆内容为空。
var ErrMemoryContentEmpty = errors.New("记忆内容不能为空")

// ErrMemoryContentTooLong 记忆内容超长（≤300 字）。
var ErrMemoryContentTooLong = errors.New("记忆内容过长（≤300 字）")

// MemoryLimit 记忆条数上限（设置·角色设定页「N / 200」的 200）。
const MemoryLimit = 200

// MaxMemoryContent 单条记忆内容上限（字符）。
const MaxMemoryContent = 300

// MemoryInjectLimit 聊天注入的记忆条数上限（全量注入取最近 N 条）。
const MemoryInjectLimit = 50

var validMemoryTypes = map[string]bool{"偏好": true, "事实": true, "习惯": true}

// daoMemStore 把 dao.MemoryDAO 适配成 memory.Store（[]dao.Memory ↔ []memory.Item 转换）。
// 适配器归 service（wiring 层）：dao 不 import harness，harness 不 import dao。
type daoMemStore struct{ dao *dao.MemoryDAO }

// NewDaoMemStore 接线入口：dao 实现 → harness 抽象（main.go 用）。
func NewDaoMemStore(d *dao.MemoryDAO) memory.Store { return &daoMemStore{dao: d} }

func convertItems(ms []dao.Memory, err error) ([]memory.Item, error) {
	if err != nil {
		return nil, err
	}
	out := make([]memory.Item, len(ms))
	for i, m := range ms {
		out[i] = memory.Item{ID: m.ID, Type: m.Type, Content: m.Content, Source: m.Source, CreatedAt: m.CreatedAt}
	}
	return out, nil
}

func (s *daoMemStore) List(ctx context.Context, q string, limit int) ([]memory.Item, error) {
	return convertItems(s.dao.List(ctx, q, limit))
}

func (s *daoMemStore) Add(ctx context.Context, typ, content, source string) (memory.Item, error) {
	m, err := s.dao.Add(ctx, typ, content, source)
	return memory.Item{ID: m.ID, Type: m.Type, Content: m.Content, Source: m.Source, CreatedAt: m.CreatedAt}, err
}

func (s *daoMemStore) Delete(ctx context.Context, id int64) (bool, error) {
	return s.dao.Delete(ctx, id)
}

func (s *daoMemStore) Count(ctx context.Context) (int, error) { return s.dao.Count(ctx) }

func (s *daoMemStore) Recent(ctx context.Context, limit int) ([]memory.Item, error) {
	return convertItems(s.dao.Recent(ctx, limit))
}

// MemoryService 长期记忆编排：校验 + 存储 + 上限；同时满足 memory.Memory（聊天注入）。
type MemoryService struct {
	store memory.Store
}

func NewMemoryService(store memory.Store) *MemoryService { return &MemoryService{store: store} }

// List 列表 + 总数（q 模糊搜索内容或类型；limit 0/负/超上限按上限）。
func (s *MemoryService) List(ctx context.Context, q string, limit int) ([]memory.Item, int, error) {
	if limit <= 0 || limit > MemoryLimit {
		limit = MemoryLimit
	}
	items, err := s.store.List(ctx, q, limit)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.store.Count(ctx)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Add 校验（类型白名单/内容非空≤300/上限 200）→ 落库（source=manual）。
func (s *MemoryService) Add(ctx context.Context, typ, content string) (memory.Item, error) {
	typ = strings.TrimSpace(typ)
	content = strings.TrimSpace(content)
	if !validMemoryTypes[typ] {
		return memory.Item{}, ErrMemoryTypeInvalid
	}
	if content == "" {
		return memory.Item{}, ErrMemoryContentEmpty
	}
	if len([]rune(content)) > MaxMemoryContent {
		return memory.Item{}, ErrMemoryContentTooLong
	}
	if n, err := s.store.Count(ctx); err != nil {
		return memory.Item{}, err
	} else if n >= MemoryLimit {
		return memory.Item{}, ErrMemoryLimit
	}
	return s.store.Add(ctx, typ, content, "manual")
}

// Delete 删除记忆；未知 id 返回 ErrMemoryNotFound。
func (s *MemoryService) Delete(ctx context.Context, id int64) error {
	ok, err := s.store.Delete(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return ErrMemoryNotFound
	}
	return nil
}

// Retrieve 全量注入实现（memory.Memory 契约）：取最近 topK 条，忽略 query 语义（M5 换检索）。
func (s *MemoryService) Retrieve(ctx context.Context, _ string, topK int) ([]memory.Item, error) {
	return s.store.Recent(ctx, topK)
}

// Remember 抽取回写（M5 实现；本版本空操作——记忆能力缺席不阻断对话）。
func (s *MemoryService) Remember(context.Context, string, []model.Message) {}

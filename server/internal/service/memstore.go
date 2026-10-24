package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"lovelybuddy/server/internal/dao"
)

// ChatStore 会话与消息持久化抽象（消费侧接口：生产 dao.ChatDAO / 测试 MemStore）。
// 方法集与 dao.ChatDAO 一致，两个实现都直接满足本接口。
type ChatStore interface {
	// DefaultSession 取最新会话，没有则创建（M2 单会话模型，title 固定）。
	DefaultSession(ctx context.Context) (string, error)
	Append(ctx context.Context, sessionID, role, content, motion string) error
	// History 最近 limit 条，按时间（id）升序返回。
	History(ctx context.Context, sessionID string, limit int) ([]dao.Message, error)
	// Clear 清空某会话全部消息（保留会话）。
	Clear(ctx context.Context, sessionID string) error
}

// MemStore 内存实现（单测 / server 集成测试用）。
type MemStore struct {
	mu       sync.Mutex
	sessions []string
	nextID   int
	msgs     map[string][]dao.Message
}

func NewMemStore() *MemStore { return &MemStore{msgs: map[string][]dao.Message{}} }

func (s *MemStore) DefaultSession(context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sessions) > 0 {
		return s.sessions[len(s.sessions)-1], nil
	}
	s.nextID++
	id := fmt.Sprintf("sess-%d", s.nextID)
	s.sessions = append(s.sessions, id)
	s.msgs[id] = nil
	return id, nil
}

func (s *MemStore) Append(_ context.Context, sessionID, role, content, motion string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.msgs[sessionID]; !ok {
		return errors.New("unknown session: " + sessionID)
	}
	s.msgs[sessionID] = append(s.msgs[sessionID],
		dao.Message{Role: role, Content: content, Motion: motion, CreatedAt: time.Now()})
	return nil
}

func (s *MemStore) History(_ context.Context, sessionID string, limit int) ([]dao.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, ok := s.msgs[sessionID]
	if !ok {
		return nil, errors.New("unknown session: " + sessionID)
	}
	if limit > 0 && len(all) > limit {
		all = all[len(all)-limit:]
	}
	out := make([]dao.Message, len(all))
	copy(out, all)
	return out, nil
}

func (s *MemStore) Clear(_ context.Context, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.msgs[sessionID]; !ok {
		return errors.New("unknown session: " + sessionID)
	}
	s.msgs[sessionID] = nil
	return nil
}

package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"lovelybuddy/server/internal/lovely-agent/memory"
)

// fakeMemStore 内存实现的 memory.Store（测试用）。
type fakeMemStore struct {
	items []memory.Item
	next  int64
}

func (f *fakeMemStore) List(_ context.Context, q string, limit int) ([]memory.Item, error) {
	var out []memory.Item
	for i := len(f.items) - 1; i >= 0; i-- { // 倒序 = 管理页顺序
		it := f.items[i]
		if q != "" && !strings.Contains(it.Content, q) && !strings.Contains(it.Type, q) {
			continue
		}
		out = append(out, it)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (f *fakeMemStore) Add(_ context.Context, typ, content, source string) (memory.Item, error) {
	f.next++
	it := memory.Item{ID: f.next, Type: typ, Content: content, Source: source, CreatedAt: time.Now()}
	f.items = append(f.items, it)
	return it, nil
}

func (f *fakeMemStore) Delete(_ context.Context, id int64) (bool, error) {
	for i, it := range f.items {
		if it.ID == id {
			f.items = append(f.items[:i], f.items[i+1:]...)
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeMemStore) Count(context.Context) (int, error) { return len(f.items), nil }

func (f *fakeMemStore) Recent(_ context.Context, limit int) ([]memory.Item, error) {
	n := limit
	if n > len(f.items) {
		n = len(f.items)
	}
	out := make([]memory.Item, n)
	copy(out, f.items[:n])
	return out, nil
}

func TestMemoryAddValidation(t *testing.T) {
	f := &fakeMemStore{}
	s := NewMemoryService(f)
	if _, err := s.Add(context.Background(), "性格", "容易生气"); !errors.Is(err, ErrMemoryTypeInvalid) {
		t.Fatalf("未知类型应报 ErrMemoryTypeInvalid: %v", err)
	}
	if _, err := s.Add(context.Background(), "偏好", "  "); !errors.Is(err, ErrMemoryContentEmpty) {
		t.Fatalf("空内容应报 ErrMemoryContentEmpty: %v", err)
	}
	if _, err := s.Add(context.Background(), "偏好", strings.Repeat("喵", 301)); !errors.Is(err, ErrMemoryContentTooLong) {
		t.Fatalf("超长应报 ErrMemoryContentTooLong: %v", err)
	}
	if len(f.items) != 0 {
		t.Fatal("非法输入不应落库")
	}
	it, err := s.Add(context.Background(), " 偏好 ", " 喜欢喝拿铁 ")
	if err != nil || it.Content != "喜欢喝拿铁" || it.Source != "manual" {
		t.Fatalf("Add: %+v err=%v", it, err)
	}
}

func TestMemoryLimitAndDelete(t *testing.T) {
	f := &fakeMemStore{}
	for i := 0; i < MemoryLimit; i++ {
		f.items = append(f.items, memory.Item{ID: int64(i + 1), Type: "事实", Content: "x"})
	}
	s := NewMemoryService(f)
	if _, err := s.Add(context.Background(), "事实", "y"); !errors.Is(err, ErrMemoryLimit) {
		t.Fatalf("超上限应报 ErrMemoryLimit: %v", err)
	}
	if err := s.Delete(context.Background(), 999); !errors.Is(err, ErrMemoryNotFound) {
		t.Fatalf("未知 id 应报 ErrMemoryNotFound: %v", err)
	}
	if err := s.Delete(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
}

func TestMemoryListTotals(t *testing.T) {
	f := &fakeMemStore{}
	s := NewMemoryService(f)
	if _, err := s.Add(context.Background(), "偏好", "喜欢喝拿铁"); err != nil {
		t.Fatal(err)
	}
	items, total, err := s.List(context.Background(), "拿铁", 10)
	if err != nil || total != 1 || len(items) != 1 {
		t.Fatalf("items=%d total=%d err=%v", len(items), total, err)
	}
}

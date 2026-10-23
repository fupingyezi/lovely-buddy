package service

import (
	"context"
	"testing"
)

func TestMemStoreSessionAndMessages(t *testing.T) {
	ctx := context.Background()
	s := NewMemStore()

	id1, err := s.DefaultSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id2, _ := s.DefaultSession(ctx)
	if id1 != id2 {
		t.Fatalf("单会话模型应复用同一会话: %q vs %q", id1, id2)
	}

	if err := s.Append(ctx, id1, "user", "你好", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.Append(ctx, id1, "assistant", "你好呀", "happy"); err != nil {
		t.Fatal(err)
	}
	if err := s.Append(ctx, id1, "user", "再见", ""); err != nil {
		t.Fatal(err)
	}

	msgs, err := s.History(ctx, id1, 10)
	if err != nil || len(msgs) != 3 {
		t.Fatalf("len=%d err=%v", len(msgs), err)
	}
	if msgs[0].Content != "你好" || msgs[2].Content != "再见" {
		t.Fatalf("应按时间升序: %+v", msgs)
	}
	if msgs[1].Motion != "happy" {
		t.Fatalf("motion=%q", msgs[1].Motion)
	}

	limited, _ := s.History(ctx, id1, 2)
	if len(limited) != 2 || limited[0].Content != "你好呀" {
		t.Fatalf("limit 应取最近 N 条升序: %+v", limited)
	}
}

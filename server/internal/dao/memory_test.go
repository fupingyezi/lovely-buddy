package dao

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestMemoryDAOCRUD(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	d := NewMemory(pool)

	// 唯一内容标记：断言只限定本用例自建行，避免与共享 dev DB 既有数据互相污染
	marker := fmt.Sprintf("喜欢喝拿铁-%d", time.Now().UnixNano())
	a, err := d.Add(ctx, "偏好", marker, "manual")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM memories WHERE id = ANY($1)`, []int64{a.ID})
	})
	b, err := d.Add(ctx, "事实", "养了一只猫", "manual")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM memories WHERE id = ANY($1)`, []int64{b.ID})
	})

	if n, err := d.Count(ctx); err != nil || n < 2 {
		t.Fatalf("Count=%d err=%v", n, err)
	}
	list, err := d.List(ctx, "", 200)
	if err != nil || len(list) < 2 {
		t.Fatalf("List: %+v err=%v", list, err)
	}
	// 自建行必须都在，且 b 在 a 之前（created_at DESC, id DESC 倒序）
	pos := map[int64]int{}
	for i, m := range list {
		pos[m.ID] = i
	}
	pa, okA := pos[a.ID]
	pb, okB := pos[b.ID]
	if !okA || !okB {
		t.Fatalf("List 应含自建行 a/b: %+v", list)
	}
	if pb >= pa {
		t.Fatalf("List 应倒序（b 新于 a）: %+v", list)
	}
	got, err := d.List(ctx, marker, 200)
	if err != nil || len(got) != 1 || got[0].ID != a.ID {
		t.Fatalf("搜索应只命中唯一内容: %+v err=%v", got, err)
	}
	got, err = d.List(ctx, "偏好", 200)
	if err != nil || len(got) == 0 {
		t.Fatalf("搜索类型应命中: %+v err=%v", got, err)
	}
	recent, err := d.Recent(ctx, 50)
	if err != nil || len(recent) < 2 {
		t.Fatalf("Recent: %+v err=%v", recent, err)
	}
	// Recent 升序：自建行 a 必须早于 b
	rpos := map[int64]int{}
	for i, m := range recent {
		rpos[m.ID] = i
	}
	ra, okA := rpos[a.ID]
	rb, okB := rpos[b.ID]
	if !okA || !okB {
		t.Fatalf("Recent 应含自建行 a/b: %+v", recent)
	}
	if rb <= ra {
		t.Fatalf("Recent 应升序（a 早于 b）: %+v", recent)
	}
	ok, err := d.Delete(ctx, a.ID)
	if err != nil || !ok {
		t.Fatalf("Delete: %v %v", ok, err)
	}
	if ok, _ := d.Delete(ctx, a.ID); ok {
		t.Fatal("重复删除应返回 false")
	}
}

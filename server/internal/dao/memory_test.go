package dao

import (
	"context"
	"testing"
)

func TestMemoryDAOCRUD(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	d := NewMemory(pool)

	a, err := d.Add(ctx, "偏好", "喜欢喝拿铁", "manual")
	if err != nil {
		t.Fatal(err)
	}
	b, err := d.Add(ctx, "事实", "养了一只猫", "manual")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM memories WHERE id = ANY($1)`, []int64{a.ID, b.ID})
	})

	if n, err := d.Count(ctx); err != nil || n < 2 {
		t.Fatalf("Count=%d err=%v", n, err)
	}
	list, err := d.List(ctx, "", 200)
	if err != nil || len(list) < 2 || list[0].ID != b.ID {
		t.Fatalf("List 应倒序: %+v err=%v", list, err)
	}
	if got, _ := d.List(ctx, "拿铁", 200); len(got) != 1 || got[0].ID != a.ID {
		t.Fatalf("搜索应命中内容: %+v", got)
	}
	if got, _ := d.List(ctx, "偏好", 200); len(got) < 1 || got[0].Type != "偏好" {
		t.Fatalf("搜索应命中类型: %+v", got)
	}
	recent, err := d.Recent(ctx, 50)
	if err != nil || len(recent) < 2 || recent[0].ID != a.ID {
		t.Fatalf("Recent 应升序: %+v err=%v", recent, err)
	}
	ok, err := d.Delete(ctx, a.ID)
	if err != nil || !ok {
		t.Fatalf("Delete: %v %v", ok, err)
	}
	if ok, _ := d.Delete(ctx, a.ID); ok {
		t.Fatal("重复删除应返回 false")
	}
}

package model

import "testing"

// 用真实 OpenAICompat 做 Swap 语义测试（无网络调用，只看持有者切换）。
func TestRegistrySwapAndCurrent(t *testing.T) {
	p1, err := New("deepseek", "", "", "k1", 0)
	if err != nil {
		t.Fatal(err)
	}
	p2, err := New("dashscope", "", "", "k2", 0)
	if err != nil {
		t.Fatal(err)
	}
	r := NewRegistry(p1)
	if r.Current() != p1 {
		t.Fatal("初始 current 应为 p1")
	}
	r.Swap(p2)
	if r.Current() != p2 {
		t.Fatal("Swap 后 current 应为 p2")
	}
}

// 发起时捕获的实例不受后续 Swap 影响（对齐设计「等当前回复结束再切」）。
func TestRegistryCapturedInstanceUnaffectedBySwap(t *testing.T) {
	p1, _ := New("deepseek", "", "", "k1", 0)
	p2, _ := New("dashscope", "", "", "k2", 0)
	r := NewRegistry(p1)
	captured := r.Current() // 对话发起时刻
	r.Swap(p2)
	if captured != p1 {
		t.Fatal("已捕获实例不应被 Swap 改变")
	}
}

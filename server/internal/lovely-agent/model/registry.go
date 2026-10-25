package model

import "sync"

// Registry 当前对话厂商的并发安全持有者。设置界面保存/启用连接后 Swap 立即生效；
// 进行中的对话在发起时捕获实例，不受切换影响（设计「等当前回复结束再切」）。
type Registry struct {
	mu  sync.RWMutex
	cur ChatProvider
}

// NewRegistry 以初始厂商建注册表（启动时的 env 兜底实例）。
func NewRegistry(initial ChatProvider) *Registry {
	return &Registry{cur: initial}
}

// Swap 原子替换当前厂商（只影响下一次对话）。
func (r *Registry) Swap(p ChatProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cur = p
}

// Current 取当前厂商；调用方捕获后使用，保证一次对话内厂商一致。
func (r *Registry) Current() ChatProvider {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.cur
}

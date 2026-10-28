package service

// MemoryService 长期记忆编排的接线位：聊天链路持有引用并据此注入记忆段（nil = 不注入）。
// 校验、存储与检索能力在此类型上实现。
type MemoryService struct{}

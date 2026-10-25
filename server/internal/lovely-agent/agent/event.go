package agent

// LoopEvent loop 输出事件；Err 非 nil 表示本轮失败（通道随后关闭）。
// done 由通道关闭隐式表达——与模型层 StreamEvent 同构；工具状态事件随工具循环功能加入
// （harness 设计 §4.4，本版本不建死字段）。
type LoopEvent struct {
	Delta string
	Err   error
}

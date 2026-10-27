// Package assets 实现形象（Live2D 模型包）的探测、导入与删除。
// 形象 = 模型根目录下的一个子目录（models/<slug>/），内含入口 *.model3.json / *.model.json，
// 可选 avatar.json 元数据与 .lovelybuddy.json 来源侧车（导入时写入）。
package assets

// Avatar 描述一个形象。JSON tag 即 API 响应格式。
type Avatar struct {
	Slug     string `json:"slug"`              // 目录名（唯一标识，删除/切换按它）
	Name     string `json:"name"`              // 展示名，缺失回退 slug
	Author   string `json:"author,omitempty"`  // 作者
	Version  string `json:"version,omitempty"` // 版本
	License  string `json:"license,omitempty"` // 许可（unknown = 未声明）
	Homepage string `json:"homepage,omitempty"`
	Persona  string `json:"persona,omitempty"` // 相对形象目录的人设文件；缺失用全局人设
	Source   string `json:"source,omitempty"`  // local | url（来自导入侧车，手工放入的为空）
	Kind     string `json:"kind"`              // moc | moc3
	Entry    string `json:"entry"`             // 相对模型根目录的入口，如 "haru/haru.model3.json"
	// 体积与表情数（探测时统计，形象管理页元信息展示用）
	SizeBytes   int64 `json:"size_bytes,omitempty"`
	Expressions int   `json:"expressions,omitempty"`

	Actions map[string]AvatarActionSpec `json:"actions,omitempty"` // 意图 → 动作/表情映射（全部可选）
}

// AvatarActionSpec 是 avatar.json actions 里单条动作映射（全部可选）。
// motion/expression 是否在模型里真实存在由前端按模型能力目录校验（无效走内置降级）。
type AvatarActionSpec struct {
	Motion      string `json:"motion,omitempty"`
	MotionIndex *int   `json:"motionIndex,omitempty"`
	Expression  string `json:"expression,omitempty"`
}

// avatar.json 的字段全部可选，损坏时按缺省处理。
type avatarJSON struct {
	Name     string `json:"name"`
	Author   string `json:"author"`
	Version  string `json:"version"`
	License  string `json:"license"`
	Homepage string `json:"homepage"`
	Persona  string `json:"persona"`

	Actions map[string]AvatarActionSpec `json:"actions,omitempty"` // 意图 → 动作/表情映射（全部可选）
}

// sidecar 是导入管线写入的 .lovelybuddy.json（审计 + UI 展示来源）。
type sidecar struct {
	Source string `json:"source"` // local | url
	Value  string `json:"value"`  // URL 或原路径
	At     string `json:"at"`     // RFC3339
}

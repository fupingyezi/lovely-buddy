// Package service 业务逻辑层：motion 标签过滤、prompt 组装、会话存储抽象与聊天编排。
// 依赖方向：dao ← service（本包）← controller；不 import gin。
package service

import (
	"regexp"
	"strings"
)

// 与 renderer live2d/motionMap.ts 的 MotionIntent 一一对应（11 个）。
var validIntents = map[string]bool{
	"idle": true, "tap": true, "greet": true, "thinking": true, "speak": true,
	"happy": true, "sad": true, "angry": true, "surprised": true, "bye": true, "sleep": true,
}

var motionTagRe = regexp.MustCompile(`\[motion:([a-zA-Z_]+)\]`)

const tagPrefix = "[motion:"

// maxHold 半截标签缓冲上限：超过则按普通文本吐回（防超长缓冲驻留）。
const maxHold = 48

// MotionFilter 流式剥离 [motion:intent] 标签：标签可能被 chunk 边界劈开，
// 可能构成标签前缀的尾巴留在 pending；Flush 把残留按原文吐回（不闭合的不是标签）。
// 行为与 renderer parseMotionTags 对齐：形似标签一律剥离；intent 合法才计为动作。
type MotionFilter struct {
	pending string
}

func NewMotionFilter() *MotionFilter { return &MotionFilter{} }

// Push 喂入增量。visible = 可安全展示的净化增量；motion = 本次新识别的意图
//（无则空串；一次 Push 含多个标签时取最后一个生效）。
func (f *MotionFilter) Push(chunk string) (visible, motion string) {
	f.pending += chunk
	return f.drain(false)
}

// Flush 流结束时调用：未闭合的残留按原文返回（它不是标签）。
func (f *MotionFilter) Flush() (visible, motion string) {
	v, m := f.drain(true)
	v += f.pending
	f.pending = ""
	return v, m
}

func (f *MotionFilter) drain(final bool) (visible, motion string) {
	for {
		if loc := motionTagRe.FindStringSubmatchIndex(f.pending); loc != nil {
			visible += f.pending[:loc[0]]
			if name := strings.ToLower(f.pending[loc[2]:loc[3]]); validIntents[name] {
				motion = name
			}
			f.pending = f.pending[loc[1]:]
			continue
		}
		// 默认全部安全吐出；仅当尾巴是半截标签时扣住
		hold := len(f.pending)
		if !final {
			// 最后一个 '[' 起的尾巴若仍可能长成标签，扣住等下一段 chunk
			if idx := strings.LastIndexByte(f.pending, '['); idx >= 0 {
				tail := f.pending[idx:]
				if len(tail) <= maxHold && maybePartialTag(tail) {
					hold = idx
				}
			}
		}
		visible += f.pending[:hold]
		f.pending = f.pending[hold:]
		return visible, motion
	}
}

// maybePartialTag tail 是否可能是一个还没传完的标签开头。
func maybePartialTag(tail string) bool {
	if strings.HasPrefix(tagPrefix, tail) { // tail 是 "[motion:" 的真前缀（含 "[" 本身）
		return true
	}
	return strings.HasPrefix(tail, tagPrefix) && !strings.Contains(tail, "]")
}

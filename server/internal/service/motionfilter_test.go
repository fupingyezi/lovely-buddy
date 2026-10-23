package service

import "testing"

func pushAll(t *testing.T, chunks ...string) (string, string) {
	t.Helper()
	f := NewMotionFilter()
	var visible, motion string
	for _, c := range chunks {
		v, m := f.Push(c)
		visible += v
		if m != "" {
			motion = m
		}
	}
	v, m := f.Flush()
	visible += v
	if m != "" {
		motion = m
	}
	return visible, motion
}

func TestMotionFilterWholeTag(t *testing.T) {
	v, m := pushAll(t, "你好[motion:happy]呀")
	if v != "你好呀" || m != "happy" {
		t.Fatalf("visible=%q motion=%q", v, m)
	}
}

func TestMotionFilterTagSplitAcrossChunks(t *testing.T) {
	// 标签被 chunk 边界劈成三段
	v, m := pushAll(t, "看这[motion:hap", "py", "]!")
	if v != "看这!" || m != "happy" {
		t.Fatalf("visible=%q motion=%q", v, m)
	}
}

func TestMotionFilterLastIntentWins(t *testing.T) {
	_, m := pushAll(t, "[motion:sad]先难过[motion:happy]后开心")
	if m != "happy" {
		t.Fatalf("motion=%q（应取最后）", m)
	}
}

func TestMotionFilterInvalidIntentStrippedButNoMotion(t *testing.T) {
	v, m := pushAll(t, "a[motion:zzz]b")
	if v != "ab" || m != "" {
		t.Fatalf("visible=%q motion=%q（非法意图剥离但不计动作）", v, m)
	}
}

func TestMotionFilterPlainBracketsPassThrough(t *testing.T) {
	v, m := pushAll(t, "数组[0]和下标a[1]b")
	if v != "数组[0]和下标a[1]b" || m != "" {
		t.Fatalf("visible=%q motion=%q", v, m)
	}
}

func TestMotionFilterUnterminatedTagFlowsBack(t *testing.T) {
	// 流结束仍不闭合 → 不是标签，按原文吐回
	v, m := pushAll(t, "结尾[motion:hap")
	if v != "结尾[motion:hap" || m != "" {
		t.Fatalf("visible=%q motion=%q", v, m)
	}
}

func TestMotionFilterIncrementalVisible(t *testing.T) {
	// Push 每次只应返回「确认安全」的增量（pending 部分不吐）；
	// 意图在标签完成的那次 Push 即返回（流式动作要尽早触发）
	f := NewMotionFilter()
	v1, m1 := f.Push("abc[mot")
	if v1 != "abc" || m1 != "" {
		t.Fatalf("v1=%q m1=%q（半截标签前缀应扣住，意图未定）", v1, m1)
	}
	v2, m2 := f.Push("ion:tap]")
	if v2 != "" || m2 != "tap" {
		t.Fatalf("v2=%q m2=%q（整段被标签吃掉，意图在完成时返回）", v2, m2)
	}
	v3, _ := f.Push("尾巴")
	if v3 != "尾巴" {
		t.Fatalf("v3=%q", v3)
	}
}

package memory

import "testing"

func TestBuildSegment(t *testing.T) {
	if got := BuildSegment(nil); got != "" {
		t.Fatalf("空列表应返回空串: %q", got)
	}
	items := []Item{
		{ID: 1, Type: "偏好", Content: "喜欢喝拿铁"},
		{ID: 2, Type: "事实", Content: "养了一只猫"},
	}
	want := "关于用户的长期记忆：\n- [偏好] 喜欢喝拿铁\n- [事实] 养了一只猫"
	if got := BuildSegment(items); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

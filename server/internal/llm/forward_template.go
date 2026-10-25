package llm

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// placeholderCtx 渲染上下文：占位符取值来源（spec §4.5）。
type placeholderCtx struct {
	LastUser  string
	System    string
	Messages  []Message
	History   []Message
	Model     string
	SessionID string
	Now       string
}

// newPlaceholderCtx 组装渲染上下文；Now = 当前毫秒时间戳。
func newPlaceholderCtx(sys, lastUser string, eff, history []Message, model, sessionID string) placeholderCtx {
	return placeholderCtx{
		LastUser: lastUser, System: sys, Messages: eff, History: history,
		Model: model, SessionID: sessionID,
		Now: strconv.FormatInt(time.Now().UnixMilli(), 10),
	}
}

// renderBody 递归渲染任意 JSON：map/slice 递归（键不渲染），string 调 renderString，其余原样。
func renderBody(v any, ctx placeholderCtx) (any, error) {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, item := range t {
			r, err := renderBody(item, ctx)
			if err != nil {
				return nil, err
			}
			out[k] = r
		}
		return out, nil
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			r, err := renderBody(item, ctx)
			if err != nil {
				return nil, err
			}
			out[i] = r
		}
		return out, nil
	case string:
		return renderString(t, ctx)
	default:
		return v, nil
	}
}

// renderString 两条规则（spec §4.5）：
//
//	整串恰好是一个占位符 → 返回原始类型（数组还是数组）
//	占位符嵌在字符串里 → 字符串拼接（值为非字符串时报错）
func renderString(s string, ctx placeholderCtx) (any, error) {
	trimmed := strings.TrimSpace(s)
	if m := phRe.FindStringSubmatchIndex(trimmed); m != nil && m[0] == 0 && m[1] == len(trimmed) {
		return valueOf(trimmed[m[2]:m[3]], ctx)
	}
	var firstErr error
	out := phRe.ReplaceAllStringFunc(s, func(tok string) string {
		m := phRe.FindStringSubmatch(tok)
		v, err := valueOf(m[1], ctx)
		if err != nil && firstErr == nil {
			firstErr = err
			return tok
		}
		str, ok := v.(string)
		if !ok {
			if firstErr == nil {
				firstErr = fmt.Errorf("占位符 %s 的值为非字符串，不能嵌入拼接", tok)
			}
			return tok
		}
		return str
	})
	if firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

// valueOf 占位符取值；未知名报错（env: 前缀读环境变量）。
func valueOf(name string, ctx placeholderCtx) (any, error) {
	switch name {
	case "last_user":
		return ctx.LastUser, nil
	case "system":
		return ctx.System, nil
	case "messages":
		return ctx.Messages, nil
	case "history":
		return ctx.History, nil
	case "model":
		return ctx.Model, nil
	case "session_id":
		return ctx.SessionID, nil
	case "now":
		return ctx.Now, nil
	default:
		if v, ok := strings.CutPrefix(name, "env:"); ok {
			return os.Getenv(v), nil
		}
		return nil, fmt.Errorf("未知占位符 {{%s}}（可用: last_user, system, messages, history, model, session_id, now, env:NAME）", name)
	}
}

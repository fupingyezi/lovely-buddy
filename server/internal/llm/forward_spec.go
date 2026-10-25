package llm

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// ForwardSpec 转发连接声明式配置（configstore.Connection.Forward 的解析形状，spec §3.2）。
type ForwardSpec struct {
	Version  int           `json:"version"`
	Request  ForwardReq    `json:"request"`
	Response ForwardResp   `json:"response"`
	Options  ForwardOpts   `json:"options"`
	Probe    *ForwardProbe `json:"probe"`
}

// ForwardReq 请求定义：URL/Method 必填，Body 任意 JSON（值里可用占位符）。
type ForwardReq struct {
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	Query     map[string]string `json:"query"`
	Body      any               `json:"body"`
	TimeoutMS int               `json:"timeout_ms"`
}

// ForwardResp 响应提取定义（type: json | text | ndjson | sse_openai）。
type ForwardResp struct {
	Type      string `json:"type"`
	TextPath  string `json:"text_path"`
	ErrorPath string `json:"error_path"`
}

// ForwardOpts 上下文与流式选项。IncludeSystem/IncludeHistory/MockStream 用 *bool：
// Go 零值是 false，不用指针无法区分「用户写了 false」和「用户没写」（spec §3.2）。
type ForwardOpts struct {
	IncludeSystem     *bool  `json:"include_system"`
	IncludeHistory    *bool  `json:"include_history"`
	SessionID         string `json:"session_id"`
	MockStream        *bool  `json:"mock_stream"`
	MockStreamChunk   int    `json:"mock_stream_chunk"`
	MockStreamDelayMS int    `json:"mock_stream_delay_ms"`
}

// ForwardProbe 「测试连接」打的目标；nil = 只做语法校验。
type ForwardProbe struct {
	URL          string `json:"url"`
	Method       string `json:"method"`
	ExpectStatus int    `json:"expect_status"`
}

// phRe 占位符：{{ name }}，name 允许字母数字下划线冒号点横线（env:NAME 用冒号）。
var phRe = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_:.-]+)\s*\}\}`)

var knownPlaceholders = map[string]bool{
	"last_user": true, "system": true, "messages": true, "history": true,
	"model": true, "session_id": true, "now": true,
}

// ParseForwardSpec 解析 + 默认值填充 + 校验（保存期与探活期共用）。
// 失败返回可读错误；坏 JSON 带行号（json.SyntaxError.Offset 换算）。
func ParseForwardSpec(raw json.RawMessage) (*ForwardSpec, error) {
	if len(raw) == 0 {
		return nil, errors.New("转发配置不能为空")
	}
	s := &ForwardSpec{}
	if err := json.Unmarshal(raw, s); err != nil {
		var se *json.SyntaxError
		if errors.As(err, &se) {
			line := 1 + strings.Count(string(raw[:se.Offset]), "\n")
			return nil, fmt.Errorf("转发配置 JSON 语法错误（第 %d 行）", line)
		}
		return nil, fmt.Errorf("转发配置 JSON 解析失败: %v", err)
	}
	if s.Version == 0 {
		s.Version = 1
	}
	if s.Version != 1 {
		return nil, fmt.Errorf("不支持的转发配置版本: %d（当前仅支持 1）", s.Version)
	}
	s.fillDefaults()
	if err := s.check(); err != nil {
		return nil, err
	}
	return s, nil
}

// fillDefaults 零值字段填默认（*bool 三态：nil 才是默认 true）。
func (s *ForwardSpec) fillDefaults() {
	if s.Request.Method == "" {
		s.Request.Method = http.MethodPost
	}
	if s.Request.TimeoutMS == 0 {
		s.Request.TimeoutMS = 120000
	}
	if s.Options.IncludeSystem == nil {
		t := true
		s.Options.IncludeSystem = &t
	}
	if s.Options.IncludeHistory == nil {
		t := true
		s.Options.IncludeHistory = &t
	}
	if s.Options.MockStream == nil {
		t := true
		s.Options.MockStream = &t
	}
	if s.Options.SessionID == "" {
		s.Options.SessionID = "default"
	}
	if s.Options.MockStreamChunk == 0 {
		s.Options.MockStreamChunk = 12
	}
	if s.Options.MockStreamDelayMS == 0 {
		s.Options.MockStreamDelayMS = 20
	}
	if s.Probe != nil {
		if s.Probe.Method == "" {
			s.Probe.Method = http.MethodGet
		}
		if s.Probe.ExpectStatus == 0 {
			s.Probe.ExpectStatus = 200
		}
	}
}

// check 必填与范围校验；错误文案要能定位字段（spec §9：写错配置是这条路上最常见的故障）。
func (s *ForwardSpec) check() error {
	u, err := url.Parse(s.Request.URL)
	if err != nil || u.Host == "" {
		return errors.New("转发配置 request.url 无效")
	}
	host := u.Hostname()
	local := host == "127.0.0.1" || host == "localhost" || host == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return errors.New("转发配置 request.url 必须为 https（本地端点可用 http）")
	}
	switch s.Request.Method {
	case http.MethodGet, http.MethodPost, http.MethodPut:
	default:
		return errors.New("转发配置 request.method 仅支持 GET/POST/PUT")
	}
	if s.Request.TimeoutMS < 1 {
		return errors.New("转发配置 request.timeout_ms 必须为正数")
	}
	switch s.Response.Type {
	case "json", "ndjson":
		if s.Response.TextPath == "" {
			return fmt.Errorf("转发配置 response.type=%s 时 text_path 必填", s.Response.Type)
		}
	case "text", "sse_openai":
	default:
		return fmt.Errorf("转发配置 response.type 非法: %q（可选: json, text, ndjson, sse_openai）", s.Response.Type)
	}
	if s.Options.MockStreamChunk < 1 {
		return errors.New("转发配置 options.mock_stream_chunk 必须 ≥ 1")
	}
	if s.Options.MockStreamDelayMS < 0 {
		return errors.New("转发配置 options.mock_stream_delay_ms 必须 ≥ 0")
	}
	if s.Probe != nil {
		if s.Probe.URL == "" {
			return errors.New("转发配置 probe.url 必填（或删除整个 probe 块）")
		}
		if s.Probe.ExpectStatus < 100 || s.Probe.ExpectStatus > 599 {
			return errors.New("转发配置 probe.expect_status 超出范围（100..599）")
		}
	}
	if name := firstUnknownPlaceholder(s); name != "" {
		return fmt.Errorf("未知占位符 {{%s}}（可用: last_user, system, messages, history, model, session_id, now, env:NAME）", name)
	}
	return nil
}

// firstUnknownPlaceholder 扫描 request.headers/query/body 里的占位符，返回第一个未知名（无则 ""）。
// env:NAME 一律放行（运行时读环境变量）。
func firstUnknownPlaceholder(s *ForwardSpec) string {
	var unknown string
	check := func(str string) {
		if unknown != "" {
			return
		}
		for _, m := range phRe.FindAllStringSubmatch(str, -1) {
			name := m[1]
			if strings.HasPrefix(name, "env:") || knownPlaceholders[name] {
				continue
			}
			unknown = name
			return
		}
	}
	for _, v := range s.Request.Headers {
		check(v)
	}
	for _, v := range s.Request.Query {
		check(v)
	}
	walkStrings(s.Request.Body, func(str string) bool {
		check(str)
		return true
	})
	return unknown
}

// walkStrings 深度遍历 JSON 值（map 键不遍历），对每个字符串调 fn；fn 返回 false 提前终止。
func walkStrings(v any, fn func(string) bool) {
	switch t := v.(type) {
	case map[string]any:
		for _, item := range t {
			walkStrings(item, fn)
		}
	case []any:
		for _, item := range t {
			walkStrings(item, fn)
		}
	case string:
		fn(t)
	}
}

// UsesPlaceholder raw 配置的字符串值里是否出现指定占位符（含 {{ name }} 空格写法）。
// 供 service 层校验「{{model}} 但模型名为空」。
func UsesPlaceholder(raw json.RawMessage, name string) bool {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return false
	}
	found := false
	walkStrings(v, func(str string) bool {
		for _, m := range phRe.FindAllStringSubmatch(str, -1) {
			if m[1] == name {
				found = true
				return false
			}
		}
		return true
	})
	return found
}

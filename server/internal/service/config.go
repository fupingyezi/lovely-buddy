package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	openai "github.com/sashabaranov/go-openai"

	"lovelybuddy/server/internal/configstore"
	"lovelybuddy/server/internal/llm"
	"lovelybuddy/server/internal/lovely-agent/model"
)

// ErrDuplicate 新增连接与既有连接重复（同厂商+BaseURL+模型+key）。
var ErrDuplicate = errors.New("该连接已存在")

// ErrNotFound 操作的连接 id 不存在。
var ErrNotFound = errors.New("连接不存在")

// ConnInput 新增/更新连接请求（POST /api/v1/config/connections、PUT …/:id）。
// Tested/TestOK = 保存前「测试连接」的结果（Tested=false = 从未测试，不落 LastCheck/CheckFail）。
type ConnInput struct {
	Provider  string          `json:"provider"`
	BaseURL   string          `json:"base_url"`
	Model     string          `json:"model"`
	APIKey    string          `json:"api_key"` // 更新时为空 = 保留原 key
	MaxTokens int             `json:"max_tokens"`
	Forward   json.RawMessage `json:"forward"` // provider=="forward" 时的声明式配置
	Tested    bool            `json:"tested"`
	TestOK    bool            `json:"test_ok"`
}

// TestInput 「测试连接」请求（POST /api/v1/config/test，不落盘）。
// ID 可选：编辑表单测试时带上正在编辑的连接 id，api_key 为空则回退该连接的存储 key。
type TestInput struct {
	Provider  string          `json:"provider"`
	BaseURL   string          `json:"base_url"`
	Model     string          `json:"model"`
	APIKey    string          `json:"api_key"`
	MaxTokens int             `json:"max_tokens"`
	Forward   json.RawMessage `json:"forward"` // provider=="forward" 时的声明式配置
	ID        string          `json:"id"`
}

// ConnectionOut 出参：APIKey 永不携带，只给掩码。
type ConnectionOut struct {
	ID        string          `json:"id"`
	Provider  string          `json:"provider"`
	BaseURL   string          `json:"base_url"`
	Model     string          `json:"model"`
	MaxTokens int             `json:"max_tokens"`
	Forward   json.RawMessage `json:"forward,omitempty"` // 回传原文供编辑回填；不含密钥（令牌走 {{env:}}）
	KeyMasked string          `json:"key_masked"`
	HasKey    bool            `json:"has_key"`
	LastCheck *time.Time      `json:"last_check"`
	CheckFail bool            `json:"check_fail"`
	Active    bool            `json:"active"`
}

// ConfigState GET /api/v1/config 出参。
type ConfigState struct {
	ActiveID    string          `json:"active_id"`
	Connections []ConnectionOut `json:"connections"`
}

// TestResult 连通测试结果（成功带 LatencyMS，失败带可读 Error 文案）。
// LatencyMS 用指针：nil = 未实际探活（无 probe，只做语法校验），非 nil 时即使 0 也会序列化。
type TestResult struct {
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
	LatencyMS *int64 `json:"latency_ms,omitempty"`
}

// ConfigService 连接配置编排：内存态 + 落盘 + 热切换 provider。
// 所有写操作持锁串行；每次写成功后立即落盘并 Swap 注册表。
type ConfigService struct {
	mu          sync.Mutex
	file        *configstore.File
	reg         *model.Registry
	fallback    model.ChatProvider // 无激活连接时聊天回退（env/.env 默认厂商）
	testTimeout time.Duration      // 测试可缩短
}

func NewConfigService(reg *model.Registry, file *configstore.File, fallback model.ChatProvider) *ConfigService {
	return &ConfigService{file: file, reg: reg, fallback: fallback, testTimeout: 10 * time.Second}
}

// State 当前配置（key 只回掩码）。
func (s *ConfigService) State() ConfigState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state()
}

func (s *ConfigService) state() ConfigState {
	out := ConfigState{ActiveID: s.file.ActiveID}
	for _, c := range s.file.Connections {
		out.Connections = append(out.Connections, ConnectionOut{
			ID: c.ID, Provider: c.Provider, BaseURL: c.BaseURL, Model: c.Model, MaxTokens: c.MaxTokens,
			Forward:   c.Forward,
			KeyMasked: configstore.MaskKey(c.APIKey), HasKey: c.APIKey != "",
			LastCheck: c.LastCheck, CheckFail: c.CheckFail, Active: c.ID == s.file.ActiveID,
		})
	}
	return out
}

// Validate 校验连接输入（M3「非法配置拒绝不落盘」的格式层）。
// BaseURL 空 = 厂商默认；http 仅允许本地端点（设计图「本地 Ollama · 127.0.0.1:11434」）。
func Validate(in TestInput) error {
	if in.Provider == "forward" {
		return validateForward(in.Forward, in.Model)
	}
	if _, ok := model.Providers[in.Provider]; !ok {
		return errors.New("未知服务商: " + in.Provider + "（可选: deepseek, dashscope, zhipu, moonshot）")
	}
	m := strings.TrimSpace(in.Model)
	if m == "" {
		return errors.New("模型名必填")
	}
	if len(m) > 100 {
		return errors.New("模型名过长（≤100 字）")
	}
	if len(in.APIKey) > 512 {
		return errors.New("API Key 过长（≤512 字）")
	}
	if in.BaseURL != "" {
		u, err := url.Parse(in.BaseURL)
		if err != nil || u.Host == "" {
			return errors.New("Base URL 无效")
		}
		host := u.Hostname()
		local := host == "127.0.0.1" || host == "localhost" || host == "::1"
		if u.Scheme != "https" && !(u.Scheme == "http" && local) {
			return errors.New("Base URL 必须为 https（本地端点可用 http）")
		}
	}
	if in.MaxTokens < 0 || in.MaxTokens > 1_000_000 {
		return errors.New("最大 Token 超出范围（0..1000000，0 = 上游默认）")
	}
	return nil
}

// Add 校验→查重→追加→激活→落盘→热切换。重复返回 ErrDuplicate，校验失败返回原错误。
func (s *ConfigService) Add(input ConnInput) (ConfigState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := Validate(toTestInput(input)); err != nil {
		return s.state(), err
	}
	for _, c := range s.file.Connections {
		if c.Provider == input.Provider && c.BaseURL == input.BaseURL &&
			c.Model == input.Model && c.APIKey == input.APIKey &&
			string(c.Forward) == string(input.Forward) {
			return s.state(), ErrDuplicate
		}
	}
	c := s.newConn(input)
	s.file.ActiveID = s.file.Add(*c).ID // ID 由 Add 内生成，取返回指针
	if err := s.file.Save(); err != nil {
		return s.state(), err
	}
	s.swapActive()
	return s.state(), nil
}

// Update 校验→更新既有连接→激活→落盘→热切换。APIKey 空 = 保留原 key。
func (s *ConfigService) Update(id string, input ConnInput) (ConfigState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.file.Find(id)
	if c == nil {
		return s.state(), ErrNotFound
	}
	if err := Validate(toTestInput(input)); err != nil {
		return s.state(), err
	}
	c.Provider, c.BaseURL, c.Model, c.MaxTokens, c.Forward = input.Provider, input.BaseURL, input.Model, input.MaxTokens, input.Forward
	if input.APIKey != "" {
		c.APIKey = input.APIKey
	}
	s.applyTest(c, input)
	s.file.ActiveID = id
	if err := s.file.Save(); err != nil {
		return s.state(), err
	}
	s.swapActive()
	return s.state(), nil
}

// Remove 删除连接（激活项回退剩余第一条，configstore 内完成）。未知 id 返回 ErrNotFound。
func (s *ConfigService) Remove(id string) (ConfigState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.file.Remove(id) {
		return s.state(), ErrNotFound
	}
	if err := s.file.Save(); err != nil {
		return s.state(), err
	}
	s.swapActive()
	return s.state(), nil
}

// SetActive 切换激活连接。未知 id 返回 ErrNotFound。
func (s *ConfigService) SetActive(id string) (ConfigState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.file.SetActive(id) {
		return s.state(), ErrNotFound
	}
	if err := s.file.Save(); err != nil {
		return s.state(), err
	}
	s.swapActive()
	return s.state(), nil
}

// Test 连通测试：临时建 provider 发 1-token 补全，不落盘不换注册表。
// 失败（含校验失败）返回 OK=false + 可读文案。
func (s *ConfigService) Test(input TestInput) TestResult {
	if err := Validate(input); err != nil {
		return TestResult{OK: false, Error: err.Error()}
	}
	if input.Provider == "forward" {
		return s.testForward(input)
	}
	key := input.APIKey
	if key == "" && input.ID != "" {
		// 编辑表单 key 未动时前端发空 key（拿不到明文）——回退正在编辑的连接的存储 key。
		// 厂商/地址已改则不回退：旧 key 属于旧端点，盲用只会误导。
		s.mu.Lock()
		if c := s.file.Find(input.ID); c != nil && c.Provider == input.Provider &&
			(input.BaseURL == "" || c.BaseURL == input.BaseURL) {
			key = c.APIKey
		}
		s.mu.Unlock()
	}
	p, err := model.New(input.Provider, input.Model, input.BaseURL, key, 1)
	if err != nil {
		return TestResult{OK: false, Error: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.testTimeout)
	defer cancel()
	start := time.Now()
	for ev := range p.StreamChat(ctx, []model.Message{{Role: "user", Content: "hi"}}) {
		if ev.Err != nil {
			timedOut := ctx.Err() != nil
			return TestResult{OK: false, Error: classifyTestErr(ev.Err, timedOut)}
		}
	}
	// StreamChat 在 ctx 取消时吞错并静默关通道——此处把超时识别回来
	if ctx.Err() != nil {
		return TestResult{OK: false, Error: "连接超时"}
	}
	latency := time.Since(start).Milliseconds()
	return TestResult{OK: true, LatencyMS: &latency}
}

// classifyStatus 上游 HTTP 状态码 → 可读中文文案；未覆盖的状态返回空。
func classifyStatus(code int) string {
	switch code {
	case 401:
		return "API Key 无效（401）"
	case 403:
		return "无权限（403）"
	case 404:
		return "模型或接口路径不存在（404）"
	case 429:
		return "请求过于频繁（429）"
	case 500, 502, 503:
		return "服务商暂时不可用（" + strconv.Itoa(code) + "）"
	}
	return ""
}

// classifyTestErr 上游错误 → 可读中文文案（不裸透传、不含 key/URL 明文）。
// APIError 与 RequestError 双匹配：后者在错误体非 JSON（如 DeepSeek 纯文本 401）时出现，
// 若只匹配前者会把 go-openai 的 JSON 解析噪音（invalid character …）透给用户。
func classifyTestErr(err error, timedOut bool) string {
	if timedOut {
		return "连接超时"
	}
	var apiErr *openai.APIError
	if errors.As(err, &apiErr) {
		if s := classifyStatus(apiErr.HTTPStatusCode); s != "" {
			return s
		}
	}
	var reqErr *openai.RequestError
	if errors.As(err, &reqErr) {
		if s := classifyStatus(reqErr.HTTPStatusCode); s != "" {
			return s
		}
	}
	return "连接失败: " + err.Error()
}

// newConn 由输入构造存储连接（含测试结果落盘）。
func (s *ConfigService) newConn(input ConnInput) *configstore.Connection {
	c := &configstore.Connection{
		Provider: input.Provider, BaseURL: input.BaseURL, Model: input.Model,
		MaxTokens: input.MaxTokens, APIKey: input.APIKey, Forward: input.Forward,
	}
	s.applyTest(c, input)
	return c
}

// applyTest 落盘保存前的测试结果：Tested 且 OK → LastCheck=now；Tested 且失败 → CheckFail。
func (s *ConfigService) applyTest(c *configstore.Connection, input ConnInput) {
	c.LastCheck, c.CheckFail = nil, false
	if !input.Tested {
		return
	}
	if input.TestOK {
		now := time.Now()
		c.LastCheck = &now
	} else {
		c.CheckFail = true
	}
}

// ApplyActive 按已保存配置恢复激活连接（启动时调用）。无激活连接或无有效配置时回退 fallback。
func (s *ConfigService) ApplyActive() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.swapActive()
}

// swapActive 按激活连接重建 provider 并热切换；无激活连接回退 env 默认。
// 返回激活连接构建失败的错误（调用方通常忽略：此时已回退 fallback）。
func (s *ConfigService) swapActive() error {
	active := s.file.Active()
	if active == nil {
		s.reg.Swap(s.fallback)
		return nil
	}
	if active.Provider == "forward" {
		p, err := llm.NewForward(active.Forward, active.Model)
		if err != nil {
			slog.Warn("激活连接无效，回退默认", "err", err)
			s.reg.Swap(s.fallback)
			return err
		}
		s.reg.Swap(p)
		return nil
	}
	p, err := model.New(active.Provider, active.Model, active.BaseURL, active.APIKey, active.MaxTokens)
	if err != nil {
		slog.Warn("激活连接无效，回退默认", "err", err)
		s.reg.Swap(s.fallback)
		return err
	}
	s.reg.Swap(p)
	return nil
}

func toTestInput(in ConnInput) TestInput {
	return TestInput{Provider: in.Provider, BaseURL: in.BaseURL, Model: in.Model, APIKey: in.APIKey, MaxTokens: in.MaxTokens, Forward: in.Forward}
}

// validateForward 转发连接的保存/测试校验（spec §4.4）：配置语法 + {{model}} 依赖。
// 不复用厂商表检查——"forward" 不在 model.Providers 里（spec §4.4：加进去会让 llm.New 用空 BaseURL 建客户端）。
func validateForward(raw json.RawMessage, model string) error {
	if _, err := llm.ParseForwardSpec(raw); err != nil {
		return err
	}
	if model == "" && llm.UsesPlaceholder(raw, "model") {
		return errors.New("转发配置用到了 {{model}} 但模型名为空")
	}
	return nil
}

// testForward 转发探活：有 probe 打 probe，无 probe 只做语法校验（spec §4.9）。
func (s *ConfigService) testForward(input TestInput) TestResult {
	spec, err := llm.ParseForwardSpec(input.Forward)
	if err != nil {
		return TestResult{OK: false, Error: err.Error()}
	}
	if spec.Probe == nil {
		return TestResult{OK: true} // LatencyMS nil → 前端显示「配置合法（未配置探活地址）」
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.testTimeout)
	defer cancel()
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, spec.Probe.Method, spec.Probe.URL, nil)
	if err != nil {
		return TestResult{OK: false, Error: "探活地址无效: " + err.Error()}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return TestResult{OK: false, Error: "探活失败: " + err.Error()}
	}
	resp.Body.Close()
	if resp.StatusCode != spec.Probe.ExpectStatus {
		return TestResult{OK: false, Error: fmt.Sprintf("探活失败: HTTP %d（期望 %d）", resp.StatusCode, spec.Probe.ExpectStatus)}
	}
	latency := time.Since(start).Milliseconds()
	return TestResult{OK: true, LatencyMS: &latency}
}

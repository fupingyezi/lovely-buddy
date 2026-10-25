package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxForwardBody = 8 << 20 // 8 MB：响应体上限（spec §4.8）

// ForwardProvider 声明式 HTTP 转发：OpenAI 形状消息 → 裁剪 → 模板渲染 → HTTP → 路径提取 → 流式事件。
// 不存任何状态——转发层一旦存东西就变成第二个脑（spec §1.2）。
type ForwardProvider struct {
	spec   *ForwardSpec
	client *http.Client
	model  string
}

// NewForward 解析 raw 配置并构建。model 供 {{model}} 占位符，可为空（service 层校验依赖关系）。
func NewForward(raw json.RawMessage, model string) (*ForwardProvider, error) {
	spec, err := ParseForwardSpec(raw)
	if err != nil {
		return nil, err
	}
	return &ForwardProvider{
		spec:   spec,
		client: &http.Client{Timeout: time.Duration(spec.Request.TimeoutMS) * time.Millisecond},
		model:  model,
	}, nil
}

func (p *ForwardProvider) Configured() bool { return p.spec != nil }
func (p *ForwardProvider) KeyEnv() string   { return "" }

// StreamChat 一次转发对话（spec §4.3）：裁剪 → 拆分 → 渲染 → 请求 → 按 type 读响应 → 推事件。
// ctx 取消时静默关通道（与 OpenAICompat 一致：ctx.Err() == nil 才推 Err）。
func (p *ForwardProvider) StreamChat(ctx context.Context, msgs []Message) <-chan StreamEvent {
	ch := make(chan StreamEvent)
	go func() {
		defer close(ch)
		eff := applyOptions(msgs, p.spec.Options)
		sys, lastUser, history := split(eff)
		phCtx := newPlaceholderCtx(sys, lastUser, eff, history, p.model, p.spec.Options.SessionID)
		body, err := renderBody(p.spec.Request.Body, phCtx)
		if err != nil {
			if ctx.Err() == nil {
				ch <- StreamEvent{Err: err}
			}
			return
		}
		resp, err := p.do(ctx, phCtx, body)
		if err != nil {
			if ctx.Err() == nil {
				ch <- StreamEvent{Err: fmt.Errorf("转发失败: %w", err)}
			}
			return
		}
		defer resp.Body.Close()
		if err := p.emit(ctx, resp, ch); err != nil && ctx.Err() == nil {
			ch <- StreamEvent{Err: err}
		}
	}()
	return ch
}

// applyOptions 按 include_system / include_history 裁剪消息。
// 裁剪必须作用在 msgs 上而不是各占位符上（spec §4.3），否则 {{system}} 与 {{messages}} 语义打架。
func applyOptions(msgs []Message, o ForwardOpts) []Message {
	eff := make([]Message, 0, len(msgs))
	for _, m := range msgs {
		if m.Role == "system" && !*o.IncludeSystem {
			continue
		}
		eff = append(eff, m)
	}
	if !*o.IncludeHistory {
		out := make([]Message, 0, 2)
		for _, m := range eff {
			if m.Role == "system" {
				out = append(out, m)
			}
		}
		if last := lastUserOf(eff); last != nil {
			out = append(out, *last)
		}
		return out
	}
	return eff
}

// lastUserOf 从后往前找最后一条 user（无则 nil）。
func lastUserOf(msgs []Message) *Message {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			return &msgs[i]
		}
	}
	return nil
}

// split 拆分 eff：system = 第一条 system 的 Content（无则 ""）；lastUser = 最后一条 user 的 Content；
// history = eff 去掉第一条 system 与最后一条 user 后的剩余（spec §4.3）。
// 实现：先定位 lastUser 下标，再单次遍历跳过首条 system 与 lastUser。
func split(eff []Message) (system, lastUser string, history []Message) {
	// 空历史也必须是空数组：nil slice 经 json.Marshal 会变 null，{{history}} 契约是数组。
	history = make([]Message, 0, len(eff))
	for _, m := range eff {
		if m.Role == "system" {
			system = m.Content
			break
		}
	}
	lastIdx := -1
	for i := len(eff) - 1; i >= 0; i-- {
		if eff[i].Role == "user" {
			lastIdx = i
			lastUser = eff[i].Content
			break
		}
	}
	systemSkipped := false
	for i, m := range eff {
		if m.Role == "system" && !systemSkipped {
			systemSkipped = true
			continue
		}
		if i == lastIdx {
			continue
		}
		history = append(history, m)
	}
	return system, lastUser, history
}

// do 组装并发出请求：URL + query + headers + body（渲染后）。非 2xx 尝试 error_path（spec §4.8）。
func (p *ForwardProvider) do(ctx context.Context, phCtx placeholderCtx, body any) (*http.Response, error) {
	req := p.spec.Request
	u, err := url.Parse(req.URL)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	for k, v := range req.Query {
		rv, err := renderString(v, phCtx)
		if err != nil {
			return nil, err
		}
		s, err := strVal("query", k, rv)
		if err != nil {
			return nil, err
		}
		q.Set(k, s)
	}
	u.RawQuery = q.Encode()

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, u.String(), reader)
	if err != nil {
		return nil, err
	}
	for k, v := range req.Headers {
		rv, err := renderString(v, phCtx)
		if err != nil {
			return nil, err
		}
		s, err := strVal("请求头", k, rv)
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set(k, s)
	}
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxForwardBody))
		if msg, ok := errText(raw, p.spec.Response.ErrorPath); ok {
			return nil, fmt.Errorf("后端返回 %d: %s", resp.StatusCode, msg)
		}
		trunc := raw
		if len(trunc) > 512 {
			trunc = trunc[:512]
		}
		return nil, fmt.Errorf("后端返回 %d: %s", resp.StatusCode, trunc)
	}
	return resp, nil
}

// strVal 要求渲染结果是字符串——{{messages}}/{{history}} 是数组，整串占位符只允许出现在 body（spec §4.5），
// 放进 query/headers 时这里报错而不是 panic。
func strVal(where, k string, v any) (string, error) {
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("%s %q 渲染后不是字符串（{{messages}}/{{history}} 是数组，只可用于 body）", where, k)
	}
	return s, nil
}

// errText 非 2xx 时按 error_path 抠错误文案；路径未命中/非 JSON 返回 ok=false。
func errText(raw []byte, path string) (string, bool) {
	if path == "" {
		return "", false
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return "", false
	}
	s, err := ExtractPath(root, path)
	if err != nil {
		return "", false
	}
	return s, true
}

// emit 按 response.type 读响应并推事件（spec §4.7 四种类型）。
func (p *ForwardProvider) emit(ctx context.Context, resp *http.Response, ch chan<- StreamEvent) error {
	typ := p.spec.Response.Type
	switch typ {
	case "json", "text":
		raw, err := io.ReadAll(io.LimitReader(resp.Body, maxForwardBody+1))
		if err != nil {
			return fmt.Errorf("读响应失败: %w", err)
		}
		if len(raw) > maxForwardBody {
			return fmt.Errorf("响应体超过 8 MB，text_path 可能写错（把整个 JSON 当文本取了）")
		}
		text, err := p.extractText(typ, raw)
		if err != nil {
			return err
		}
		if !*p.spec.Options.MockStream {
			return send(ctx, ch, StreamEvent{Delta: text})
		}
		return p.emitChunked(ctx, text, ch)
	case "ndjson":
		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
		for sc.Scan() {
			line := sc.Text()
			if strings.TrimSpace(line) == "" {
				continue
			}
			text, err := p.extractText("json", []byte(line))
			if err != nil {
				return err
			}
			if err := send(ctx, ch, StreamEvent{Delta: text}); err != nil {
				return err
			}
		}
		return sc.Err()
	case "sse_openai":
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			line := sc.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data: "))
			if data == "[DONE]" {
				return nil
			}
			var ev struct {
				Choices []struct {
					Delta struct {
						Content string `json:"content"`
					} `json:"delta"`
				} `json:"choices"`
			}
			if err := json.Unmarshal([]byte(data), &ev); err != nil {
				continue // 非目标 JSON 帧（如 usage）跳过，不中断流
			}
			if len(ev.Choices) > 0 && ev.Choices[0].Delta.Content != "" {
				if err := send(ctx, ch, StreamEvent{Delta: ev.Choices[0].Delta.Content}); err != nil {
					return err
				}
			}
		}
		return sc.Err()
	default:
		return fmt.Errorf("未知响应类型: %s", typ)
	}
}

// extractText json 类型走 ExtractPath；text 类型整 body 当文本。
func (p *ForwardProvider) extractText(typ string, raw []byte) (string, error) {
	if typ == "text" {
		return string(raw), nil
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return "", fmt.Errorf("响应不是合法 JSON: %v", err)
	}
	return ExtractPath(root, p.spec.Response.TextPath)
}

// emitChunked 按 rune 切块模拟流式（spec §4.7：按 rune 不按 byte，中文不乱码）；
// sleepCtx 保证「停止」即时生效（spec §4.7）。
func (p *ForwardProvider) emitChunked(ctx context.Context, text string, ch chan<- StreamEvent) error {
	runes := []rune(text)
	n := p.spec.Options.MockStreamChunk
	for i := 0; i < len(runes); i += n {
		end := i + n
		if end > len(runes) {
			end = len(runes)
		}
		if err := send(ctx, ch, StreamEvent{Delta: string(runes[i:end])}); err != nil {
			return err
		}
		if err := p.sleepCtx(ctx); err != nil {
			return err
		}
	}
	return nil
}

// sleepCtx 可中断延迟：time.Sleep 会让「停止」等整段推完才响应。
func (p *ForwardProvider) sleepCtx(ctx context.Context) error {
	select {
	case <-time.After(time.Duration(p.spec.Options.MockStreamDelayMS) * time.Millisecond):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// send 带 ctx 检查的事件发送。
func send(ctx context.Context, ch chan<- StreamEvent, ev StreamEvent) error {
	select {
	case ch <- ev:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

package service

import (
	"errors"
	"os/user"
	"strings"
	"sync"
	"time"

	"lovelybuddy/server/internal/configstore"
)

// ErrPersonaTooLong 人设提示词超过 2000 字上限（校验失败，不落盘）。
var ErrPersonaTooLong = errors.New("人设提示词过长（≤2000 字）")

// PersonaService 角色设定配置编排：内存态 + 落盘。写操作持锁串行，写成功后立即落盘。
type PersonaService struct {
	mu   sync.Mutex
	file *configstore.File
}

func NewPersonaService(file *configstore.File) *PersonaService { return &PersonaService{file: file} }

// State 当前人设配置。
func (s *PersonaService) State() configstore.Persona {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.file.Persona
}

// Update 校验（trim 后 ≤2000 字）→ 落盘。校验失败返回 ErrPersonaTooLong 且不落盘；
// 落盘失败回滚内存态，保证内存与磁盘一致。
func (s *PersonaService) Update(text string, enabled bool) (configstore.Persona, error) {
	text = strings.TrimSpace(text)
	if len([]rune(text)) > 2000 {
		return s.State(), ErrPersonaTooLong
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	prev := s.file.Persona
	s.file.Persona = configstore.Persona{Text: text, Enabled: enabled}
	if err := s.file.Save(); err != nil {
		s.file.Persona = prev
		return s.file.Persona, err
	}
	return s.file.Persona, nil
}

// Custom 当前自定义人设（text 为空时 Enabled 视为 false——空文案不参与组合）。
func (s *PersonaService) Custom() configstore.Persona {
	p := s.State()
	if p.Text == "" {
		p.Enabled = false
	}
	return p
}

// ComposePersona 人设组合（覆盖/追加开关语义）：
// 自定义空 → 只用内置；内置空 → 只用自定义；Enabled → 自定义覆盖；否则追加在内置末尾。
func ComposePersona(builtin string, custom configstore.Persona) string {
	b := strings.TrimSpace(builtin)
	c := strings.TrimSpace(custom.Text)
	switch {
	case c == "":
		return b
	case b == "":
		return c
	case custom.Enabled:
		return c
	default:
		return b + "\n\n" + c
	}
}

// expandPersonaVars 人设变量替换：{user_name}→系统用户名、{time}→HH:mm、{model}→当前模型名。
// 用户名取不到时用「用户」；模型名空时替换为空串。
func expandPersonaVars(text, modelName string) string {
	if text == "" {
		return ""
	}
	userName := "用户"
	if u, err := user.Current(); err == nil {
		if n := strings.TrimSpace(u.Name); n != "" {
			userName = n
		}
	}
	repl := map[string]string{
		"{user_name}": userName,
		"{time}":      time.Now().Format("15:04"),
		"{model}":     modelName,
	}
	out := text
	for k, v := range repl {
		out = strings.ReplaceAll(out, k, v)
	}
	return out
}

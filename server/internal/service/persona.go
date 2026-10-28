package service

import (
	"errors"
	"strings"
	"sync"

	"lovelybuddy/server/internal/configstore"
)

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

// Update 校验（trim 后 ≤2000 字）→ 落盘。校验失败不落盘。
func (s *PersonaService) Update(text string, enabled bool) (configstore.Persona, error) {
	text = strings.TrimSpace(text)
	if len([]rune(text)) > 2000 {
		return s.State(), errors.New("人设提示词过长（≤2000 字）")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.file.Persona = configstore.Persona{Text: text, Enabled: enabled}
	if err := s.file.Save(); err != nil {
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

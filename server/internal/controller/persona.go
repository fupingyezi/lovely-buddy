package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/service"
)

// Persona 角色设定接口（设置·角色设定页）。业务在 service.PersonaService，本层只做 HTTP 胶水。
type Persona struct{ svc *service.PersonaService }

func NewPersona(svc *service.PersonaService) *Persona { return &Persona{svc: svc} }

// State GET /api/v1/persona → {text, enabled}。
func (h *Persona) State(c *gin.Context) { c.JSON(http.StatusOK, h.svc.State()) }

// Update PUT /api/v1/persona body {text, enabled} → 保存；422 校验失败不落盘。
func (h *Persona) Update(c *gin.Context) {
	var req struct {
		Text    string `json:"text"`
		Enabled bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	state, err := h.svc.Update(req.Text, req.Enabled)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, state)
}

package controller

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/service"
)

// Config 模型与连接配置接口（M3 设置面板）。业务全在 service.ConfigService，本层只做 HTTP 胶水。
type Config struct{ svc *service.ConfigService }

func NewConfig(svc *service.ConfigService) *Config { return &Config{svc: svc} }

// State GET /api/v1/config → 当前配置（key 只回掩码）。
func (h *Config) State(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.State())
}

// Add POST /api/v1/config/connections → 校验+保存+激活；非法 422 不落盘。
func (h *Config) Add(c *gin.Context) {
	var req service.ConnInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	// 先校验（与 service 内部校验同源）：422 不落盘；service 内部仍会再校验一次兜底
	if err := service.Validate(service.TestInput{
		Provider: req.Provider, BaseURL: req.BaseURL, Model: req.Model, APIKey: req.APIKey, MaxTokens: req.MaxTokens,
	}); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	state, err := h.svc.Add(req)
	h.respondMutation(c, state, err)
}

// Update PUT /api/v1/config/connections/:id → 更新+激活（key 空 = 保留原 key）。
func (h *Config) Update(c *gin.Context) {
	var req service.ConnInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := service.Validate(service.TestInput{
		Provider: req.Provider, BaseURL: req.BaseURL, Model: req.Model, APIKey: req.APIKey, MaxTokens: req.MaxTokens,
	}); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	state, err := h.svc.Update(c.Param("id"), req)
	h.respondMutation(c, state, err)
}

// Remove DELETE /api/v1/config/connections/:id → 删除（激活项回退剩余第一条）。
func (h *Config) Remove(c *gin.Context) {
	state, err := h.svc.Remove(c.Param("id"))
	h.respondMutation(c, state, err)
}

// SetActive PUT /api/v1/config/active body {id} → 切换激活连接。
func (h *Config) SetActive(c *gin.Context) {
	var req struct {
		ID string `json:"id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	state, err := h.svc.SetActive(req.ID)
	h.respondMutation(c, state, err)
}

// Test POST /api/v1/config/test → 连通测试。格式非法 422；上游失败 200 + ok:false
// （前端浮红字保留输入）。
func (h *Config) Test(c *gin.Context) {
	var req service.TestInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := service.Validate(req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, h.svc.Test(req))
}

// respondMutation 写操作统一出口：ErrNotFound→404、ErrDuplicate→422、落盘失败→500，
// 其余 200 回全量 ConfigState。
func (h *Config) respondMutation(c *gin.Context, state service.ConfigState, err error) {
	switch {
	case err == nil:
		c.JSON(http.StatusOK, state)
	case errors.Is(err, service.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrDuplicate):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
	default:
		slog.Error("config: 配置保存失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "配置保存失败"})
	}
}

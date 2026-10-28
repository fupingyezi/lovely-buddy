package controller

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/service"
)

// Memory 长期记忆接口（设置·角色设定页）。业务在 service.MemoryService，本层只做 HTTP 胶水。
type Memory struct{ svc *service.MemoryService }

func NewMemory(svc *service.MemoryService) *Memory { return &Memory{svc: svc} }

// List GET /api/v1/memories?q=&limit= → {memories, total, limit}。
func (h *Memory) List(c *gin.Context) {
	q := c.Query("q")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	items, total, err := h.svc.List(c.Request.Context(), q, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "记忆读取失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"memories": items, "total": total, "limit": service.MemoryLimit})
}

// Add POST /api/v1/memories body {type, content} → 201 {memory}；422 校验失败/上限。
func (h *Memory) Add(c *gin.Context) {
	var req struct {
		Type    string `json:"type"`
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	item, err := h.svc.Add(c.Request.Context(), req.Type, req.Content)
	if err != nil {
		if errors.Is(err, service.ErrMemoryLimit) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "记忆数量已达上限 200 条"})
			return
		}
		if errors.Is(err, service.ErrMemoryTypeInvalid) ||
			errors.Is(err, service.ErrMemoryContentEmpty) ||
			errors.Is(err, service.ErrMemoryContentTooLong) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		slog.Error("记忆保存失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "记忆保存失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"memory": item})
}

// Delete DELETE /api/v1/memories/:id → {ok:true}；404 未知 id。
func (h *Memory) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		if errors.Is(err, service.ErrMemoryNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "记忆不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "记忆删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

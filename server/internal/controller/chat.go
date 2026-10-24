package controller

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/service"
)

// Chat 聊天接口（流式编排全在 service.ChatService，本层只做 HTTP 胶水）。
type Chat struct{ svc *service.ChatService }

func NewChat(svc *service.ChatService) *Chat { return &Chat{svc: svc} }

// Send POST /api/v1/chat → text/event-stream（事件流直至 done/error）。
// 客户端断开（停止生成）时 c.Request.Context() 取消，service 照常半截入库后收尾。
func (h *Chat) Send(c *gin.Context) {
	if h.svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "chat 服务未初始化"})
		return
	}
	var req struct {
		Avatar  string `json:"avatar"`
		Message string `json:"message"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" || len(req.Message) > 4000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message 必填且不超过 4000 字"})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.Flush()
	for ev := range h.svc.Stream(c.Request.Context(), req.Avatar, req.Message) {
		payload, _ := json.Marshal(ev)
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", ev.Type, payload)
		c.Writer.Flush()
	}
}

// History GET /api/v1/history?limit=50 → {session_id, messages}（limit 夹 1..200）。
func (h *Chat) History(c *gin.Context) {
	if h.svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "chat 服务未初始化"})
		return
	}
	limit := 50
	if v, err := strconv.Atoi(c.Query("limit")); err == nil {
		limit = v
	}
	limit = min(max(limit, 1), 200)
	id, msgs, err := h.svc.History(c.Request.Context(), limit)
	if err != nil {
		slog.Error("chat: 历史读取失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "历史读取失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session_id": id, "messages": msgs})
}

// Clear DELETE /api/v1/history → 清空默认会话全部消息（保留会话行）。
func (h *Chat) Clear(c *gin.Context) {
	if h.svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "chat 服务未初始化"})
		return
	}
	if err := h.svc.ClearHistory(c.Request.Context()); err != nil {
		slog.Error("chat: 清空对话记录失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "清空失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

package controller

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"lovelybuddy/server/internal/assets"
)

// Assets 形象库接口（业务在 internal/assets 域包，本层只做 HTTP 胶水）。
type Assets struct{ modelDir string }

func NewAssets(modelDir string) *Assets { return &Assets{modelDir: modelDir} }

// List GET /api/v1/assets → {avatars}
func (a *Assets) List(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"avatars": assets.Detect(a.modelDir)})
}

// Import POST /api/v1/assets/import body {source} → {avatar}（失败 422 {error}）
func (a *Assets) Import(c *gin.Context) {
	var req struct {
		Source assets.ImportSource `json:"source"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	av, err := assets.Import(a.modelDir, req.Source)
	if err != nil {
		slog.Error("assets: 导入失败", "source", req.Source.Type, "err", err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"avatar": av})
}

// Delete DELETE /api/v1/assets/:slug → {ok:true}（非法 slug 400）
func (a *Assets) Delete(c *gin.Context) {
	if err := assets.Delete(a.modelDir, c.Param("slug")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

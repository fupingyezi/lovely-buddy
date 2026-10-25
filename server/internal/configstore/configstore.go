// Package configstore 「模型与连接」配置的本地持久化（M3）：单一 JSON 文件（0600，原子写）。
// 对话 API 的 provider/model/key 由设置界面经 /api/v1/config 注入并接管（用户决策：
// 界面注入而非环境注入）；env/.env 仅在没有已保存连接时作为兜底默认来源。
// APIKey 明文只存在于本文件，任何 API 出参/日志/错误文案不得携带。
package configstore

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Connection 一条已保存的厂商连接。LastCheck 非空 = 最近一次测试连接成功；
// CheckFail = 最近一次测试失败；两者皆无 = 从未测试。
type Connection struct {
	ID        string          `json:"id"`
	Provider  string          `json:"provider"`   // model.Providers 的键（deepseek/dashscope/zhipu/moonshot）或 "forward"
	BaseURL   string          `json:"base_url"`   // 空 = 厂商默认地址
	Model     string          `json:"model"`      // 空 = 厂商默认模型
	MaxTokens int             `json:"max_tokens"` // 0 = 不传（上游默认）
	APIKey    string          `json:"api_key"`
	Forward   json.RawMessage `json:"forward,omitempty"` // 仅 provider=="forward"；声明式转发配置（forward.ForwardSpec）
	LastCheck *time.Time      `json:"last_check"`
	CheckFail bool            `json:"check_fail"`
}

// File 磁盘文件的内存态。读写都经 Save/Load。
type File struct {
	ActiveID    string       `json:"active_id"`
	Connections []Connection `json:"connections"`
}

// Path 配置文件路径：LOVELYBUDDY_CONFIG_FILE 优先，
// 默认 os.UserConfigDir()/lovelybuddy/config.json（macOS ~/Library/Application Support）。
func Path() string {
	if p := os.Getenv("LOVELYBUDDY_CONFIG_FILE"); p != "" {
		return p
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "lovelybuddy.config.json"
	}
	return filepath.Join(base, "lovelybuddy", "config.json")
}

// Load 读入配置。文件不存在 = 合法空配置（返回空 File）；
// JSON 损坏返回错误——调用方告警后用空 File 兜底、不覆盖原文件。
func Load() (*File, error) {
	raw, err := os.ReadFile(Path())
	if err != nil {
		if os.IsNotExist(err) {
			return &File{}, nil
		}
		return nil, err
	}
	f := &File{}
	if err := json.Unmarshal(raw, f); err != nil {
		return nil, fmt.Errorf("配置解析失败: %w", err)
	}
	return f, nil
}

// Save 原子写回（0600）：先写临时文件再 rename，写坏不破坏旧文件。
func (f *File) Save() error {
	path := Path()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// MaskKey 掩码：前 3 + 16 个 • + 后 4（设计图实测，如 sk-••••••••••••••••3f2a）；
// 长度 ≤ 8 全掩码。
func MaskKey(key string) string {
	if len(key) <= 8 {
		return "••••••••••••••••"
	}
	return key[:3] + "••••••••••••••••" + key[len(key)-4:]
}

// newID 8 位随机 hex 前缀 c（c3f2a91b）。
func newID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "c" + hex.EncodeToString(b)
}

// Add 追加连接（查重在 service 层做）并生成 ID，返回新连接指针。
func (f *File) Add(c Connection) *Connection {
	c.ID = newID()
	f.Connections = append(f.Connections, c)
	return &f.Connections[len(f.Connections)-1]
}

// Remove 删除连接；删掉激活项时回退到剩余第一条（无剩余则空）。
// 未知 id 返回 false。
func (f *File) Remove(id string) bool {
	for i, c := range f.Connections {
		if c.ID == id {
			f.Connections = append(f.Connections[:i], f.Connections[i+1:]...)
			if f.ActiveID == id {
				f.ActiveID = ""
				if len(f.Connections) > 0 {
					f.ActiveID = f.Connections[0].ID
				}
			}
			return true
		}
	}
	return false
}

// SetActive 切换激活连接；未知 id 返回 false。
func (f *File) SetActive(id string) bool {
	for _, c := range f.Connections {
		if c.ID == id {
			f.ActiveID = id
			return true
		}
	}
	return false
}

// Active 当前激活连接（无则 nil）。
func (f *File) Active() *Connection {
	return f.Find(f.ActiveID)
}

// Find 按 id 找连接（无则 nil）。
func (f *File) Find(id string) *Connection {
	for i := range f.Connections {
		if f.Connections[i].ID == id {
			return &f.Connections[i]
		}
	}
	return nil
}

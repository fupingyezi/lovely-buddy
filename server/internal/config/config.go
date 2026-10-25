// Package config 读取运行配置。M2 从环境变量 + .env 文件读取（.env 不覆盖已有环境变量）；
// M3 设置面板接管厂商/key 的读写后，这里仍是 env 侧的默认来源。
package config

import (
	"bufio"
	"os"
	"strings"
)

// Chat 对话模型配置。
type Chat struct {
	Provider string // deepseek | dashscope；空 = deepseek（model.Resolve 兜底）
	Model    string // 空 = 用厂商默认模型
	BaseURL  string // 空 = 用厂商默认地址；非空覆盖（任意 OpenAI 兼容端点）
}

type Config struct {
	Chat Chat
}

// LoadEnvFile 逐行加载 KEY=VALUE（# 注释、空行、无 = 行忽略；value 剥成对引号）。
// 已存在的环境变量不覆盖（真实 env 优先）。文件不存在返回 nil（未建 .env 合法）。
func LoadEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' && v[len(v)-1] == '"' || v[0] == '\'' && v[len(v)-1] == '\'') {
			v = v[1 : len(v)-1]
		}
		if k != "" && os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
	return sc.Err()
}

// envFile 查找顺序：LOVELYBUDDY_ENV_FILE → ../.env（air 在 server/ 下运行 = 仓库根）→ ./.env。
func envFile() string {
	if p := os.Getenv("LOVELYBUDDY_ENV_FILE"); p != "" {
		return p
	}
	if _, err := os.Stat("../.env"); err == nil {
		return "../.env"
	}
	return ".env"
}

// Load 加载 .env 后解析全部配置。
func Load() Config {
	_ = LoadEnvFile(envFile())
	return Config{
		Chat: Chat{
			Provider: os.Getenv("LOVELYBUDDY_CHAT_PROVIDER"),
			Model:    os.Getenv("LOVELYBUDDY_CHAT_MODEL"),
			BaseURL:  os.Getenv("LOVELYBUDDY_CHAT_BASE_URL"),
		},
	}
}

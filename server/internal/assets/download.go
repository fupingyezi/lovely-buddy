package assets

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"time"
)

// maxDownload 下载大小上限（压缩包字节数，512MB）。
var maxDownload = int64(512 << 20)

// httpClient 是包级变量：单测换 TLS 配置；生产用默认客户端。
var httpClient *http.Client = http.DefaultClient

// Download 下载 URL（仅 https）到模型根目录内的临时文件，超时 10 分钟，失败重试 2 次。
// 调用方负责删除临时文件。来源 URL 记入审计日志。
func Download(root, rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return "", fmt.Errorf("仅支持 HTTPS URL")
	}
	slog.Info("assets: 下载形象", "url", rawURL)
	f, err := os.CreateTemp(root, ".download-")
	if err != nil {
		return "", err
	}
	path := f.Name()
	if err := f.Close(); err != nil {
		return "", err
	}

	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if attempt > 1 {
			slog.Warn("assets: 下载重试", "attempt", attempt, "err", lastErr)
		}
		if lastErr = tryDownload(u, path); lastErr == nil {
			return path, nil
		}
	}
	os.Remove(path)
	return "", fmt.Errorf("下载失败（已重试 2 次）: %w", lastErr)
}

func tryDownload(u *url.URL, path string) error {
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	resp, err := httpClient.Do(req.WithContext(ctx))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	out, err := os.Create(path)
	if err != nil {
		return err
	}
	defer out.Close()
	n, err := io.Copy(out, io.LimitReader(resp.Body, maxDownload+1))
	if err != nil {
		return err
	}
	if n > maxDownload {
		return fmt.Errorf("超过大小上限 512MB")
	}
	return nil
}

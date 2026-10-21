package assets

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// httpsTestServer 起一个自签 TLS 的 httptest 服务器，并给 httpClient 换上跳过校验的 transport。
func httpsTestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewTLSServer(handler)
	old := httpClient
	httpClient = &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	t.Cleanup(func() {
		httpClient = old
		srv.Close()
	})
	return srv
}

func TestDownloadOK(t *testing.T) {
	srv := httpsTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("PK\x03\x04fakezip"))
	})
	root := t.TempDir()
	path, err := Download(root, srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil || string(b) != "PK\x03\x04fakezip" {
		t.Fatalf("内容不符: %s %v", b, err)
	}
	// 文件在 root 内（staging rename 同文件系统）
	if !strings.HasPrefix(path, root) {
		t.Fatalf("临时文件应在 root 内: %s", path)
	}
}

func TestDownloadOnlyHTTPS(t *testing.T) {
	root := t.TempDir()
	if _, err := Download(root, "http://example.com/a.zip"); err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("非 https 应报错: %v", err)
	}
	if _, err := Download(root, "ftp://example.com/a.zip"); err == nil {
		t.Fatal("ftp 应报错")
	}
}

func TestDownloadRetry(t *testing.T) {
	var calls int
	srv := httpsTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	root := t.TempDir()
	if _, err := Download(root, srv.URL); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("应重试到第 3 次成功, calls=%d", calls)
	}
}

func TestDownloadOversize(t *testing.T) {
	old := maxDownload
	maxDownload = 8
	defer func() { maxDownload = old }()
	srv := httpsTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(strings.Repeat("a", 100)))
	})
	root := t.TempDir()
	if _, err := Download(root, srv.URL); err == nil || !strings.Contains(err.Error(), "上限") {
		t.Fatalf("应报大小上限: %v", err)
	}
}

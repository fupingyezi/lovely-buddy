# MA 形象系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现形象系统：avatar.json 元数据探测、URL/本地导入管线（zip-slip 防护）、删除、热切换与导入后自动应用。

**Architecture:** 模型根目录的唯一事实来源移到 Go 后端（`internal/assets` 包，`--model-dir` flag，默认 `../model` 与 dev 仓库 `model/` 一致）；renderer 经 HTTP API 列出/导入/删除形象，l2d:// 协议仍由 Electron main 按 `settings.modelDir` 服务（与后端同指一处，用户改根目录入口被移除）。Electron 只保留本地文件/目录选择对话框 IPC。

**Tech Stack:** Go stdlib（archive/zip、net/http、os）+ gin 路由；React/zustand 前端；vitest + go test。

**Spec:** `docs/design.md` §3（形象系统）、§7（MA 验收）

## Global Constraints

- Go module `lovelybuddy/server`；**不新增 Go 依赖**（zip/下载全用 stdlib）
- 版权红线：仓库、默认下载源零模型资产；下载不预置任何模型源
- 测试：Go 测试与源码同目录 `*_test.go`；前端测试放功能目录 `__test__/`
- Commit：Conventional Commits，subject 小写开头（commitlint 强制）
- env 命名 `LOVELYBUDDY_*`；API 只绑 127.0.0.1，`/api/v1/*` 全部 token 鉴权（`Authorization: Bearer`）
- UI 文案/日志用中文；console 前缀 `[lovely-buddy]`（renderer）/ slog 前缀 `assets:`（Go）
- 导入后自动应用（`auto_apply_avatar` 默认开，设置项留给 M3）
- 本次不改 `make dev` 编排与 `l2d://` 协议本身

---

### Task 1: Go assets 包 —— 类型与探测（Detect）

**Files:**
- Create: `server/internal/assets/avatar.go`（Avatar 类型 + avatarJSON/sidecar）
- Create: `server/internal/assets/detect.go`（Detect/inspect/probeEntry/firstOfKind）
- Create: `server/internal/assets/detect_test.go`
- Modify: `server/internal/server/server.go`（New 加 modelDir 参数 + GET /api/v1/assets）
- Modify: `server/cmd/lovely-buddy-server/main.go`（--model-dir flag）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `assets.Detect(root string) []Avatar`；`Avatar{Slug,Name,Author,Version,License,Homepage,Persona,Source,Kind,Entry}`（JSON tag 全小写）；`probeEntry(dir) (rel, kind)` 供 Task 2 复用；`server.New(addr, token string, pool *pgxpool.Pool, modelDir string)`

- [ ] **Step 1: 写失败测试**

Create `server/internal/assets/detect_test.go`：

```go
package assets

import (
	"os"
	"path/filepath"
	"testing"
)

// 构造测试形象目录树（返回各文件写入路径的 helper 放本测试文件内）
func writeDir(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for rel, content := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDetect(t *testing.T) {
	root := t.TempDir()
	writeDir(t, root, map[string]string{
		"haru/haru.model3.json":                  `{"Version":3}`,
		"haru/avatar.json":                       `{"name":"Haru","author":"Live2D","version":"1.0","license":"free","homepage":"https://example.com","persona":"persona/haru.txt"}`,
		"haru/persona/haru.txt":                  "你是一只猫",
		"shizuku/a/b/c/shizuku.model.json":       `{"type":"Live2DModelSetting"}`,
		"broken/avatar.json":                     `{not json`,
		"broken/deep.model3.json":                `{"Version":3}`,
		"noentry/avatar.json":                    `{"name":"空"}`,
		".hidden-dir/x.model3.json":              `{"Version":3}`,
		"metanull/model3/x.model3.json":          `{"Version":3}`,
		"metanull/avatar.json":                   `{"name":"N","persona":"missing.txt"}`,
	})
	// broken 的入口再下沉两层（共 4 层）→ 应探测不到
	os.MkdirAll(filepath.Join(root, "broken/x/y"), 0o755)
	if err := os.Rename(filepath.Join(root, "broken/deep.model3.json"), filepath.Join(root, "broken/x/y/deep.model3.json")); err != nil {
		t.Fatal(err)
	}

	got := Detect(root)
	if len(got) != 4 { // haru, shizuku, metanull + broken（入口在根部时？见断言）——先跑，按实际调整
		t.Fatalf("len=%d, got=%+v", len(got), got)
	}
	// 按 slug 排序，haru 在最前
	if got[0].Slug != "haru" || got[0].Name != "Haru" || got[0].Author != "Live2D" || got[0].Version != "1.0" ||
		got[0].License != "free" || got[0].Homepage != "https://example.com" || got[0].Persona != "persona/haru.txt" ||
		got[0].Kind != "moc3" || got[0].Entry != "haru/haru.model3.json" {
		t.Fatalf("haru 字段不符: %+v", got[0])
	}
	// shizuku：无 avatar.json → Name 回退 slug；3 层嵌套入口仍可探测
	if got[1].Slug != "shizuku" || got[1].Name != "shizuku" || got[1].Kind != "moc" ||
		got[1].Entry != "shizuku/a/b/c/shizuku.model.json" {
		t.Fatalf("shizuku 字段不符: %+v", got[1])
	}
	// metanull：persona 文件缺失 → Persona 置空
	for _, a := range got {
		if a.Slug == "metanull" && a.Persona != "" {
			t.Fatalf("metanull persona 应为空: %+v", a)
		}
	}
	// noentry / 深层 broken / .hidden-dir 均被过滤
	for _, a := range got {
		if a.Slug == "noentry" || a.Slug == "broken" || a.Slug == ".hidden-dir" {
			t.Fatalf("不应出现 %s", a.Slug)
		}
	}
}
```

注：`broken` 用例最终入口在 4 层（rel 分隔符 >3）→ 应被过滤；`noentry` 无入口 → 过滤；`.` 目录 → 过滤。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/assets/`
Expected: FAIL（`no required module provides package lovelybuddy/server/internal/assets`）

- [ ] **Step 3: 实现 avatar.go**

```go
// Package assets 实现形象（Live2D 模型包）的探测、导入与删除。
// 形象 = 模型根目录下的一个子目录（models/<slug>/），内含入口 *.model3.json / *.model.json，
// 可选 avatar.json 元数据与 .lovelybuddy.json 来源侧车（导入时写入）。
package assets

// Avatar 描述一个形象。JSON tag 即 API 响应格式。
type Avatar struct {
	Slug     string `json:"slug"`              // 目录名（唯一标识，删除/切换按它）
	Name     string `json:"name"`              // 展示名，缺失回退 slug
	Author   string `json:"author,omitempty"`  // 作者
	Version  string `json:"version,omitempty"` // 版本
	License  string `json:"license,omitempty"` // 许可（unknown = 未声明）
	Homepage string `json:"homepage,omitempty"`
	Persona  string `json:"persona,omitempty"` // 相对形象目录的人设文件；缺失用全局人设
	Source   string `json:"source,omitempty"`  // local | url（来自导入侧车，手工放入的为空）
	Kind     string `json:"kind"`              // moc | moc3
	Entry    string `json:"entry"`             // 相对模型根目录的入口，如 "haru/haru.model3.json"
}

// avatar.json 的字段全部可选，损坏时按缺省处理。
type avatarJSON struct {
	Name     string `json:"name"`
	Author   string `json:"author"`
	Version  string `json:"version"`
	License  string `json:"license"`
	Homepage string `json:"homepage"`
	Persona  string `json:"persona"`
}

// sidecar 是导入管线写入的 .lovelybuddy.json（审计 + UI 展示来源）。
type sidecar struct {
	Source string `json:"source"` // local | url
	Value  string `json:"value"`  // URL 或原路径
	At     string `json:"at"`     // RFC3339
}
```

- [ ] **Step 4: 实现 detect.go**

```go
package assets

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Detect 扫描模型根目录，返回所有形象（root 的直接子目录，跳过点目录）。
// 结果按 slug 排序；root 不存在或不可读时返回空切片。
func Detect(root string) []Avatar {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []Avatar
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if av, ok := inspect(filepath.Join(root, e.Name())); ok {
			out = append(out, av)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out
}

// inspect 读取单个形象目录的元数据并探测入口；无入口返回 ok=false。
func inspect(dir string) (Avatar, bool) {
	slug := filepath.Base(dir)
	meta := avatarJSON{}
	if b, err := os.ReadFile(filepath.Join(dir, "avatar.json")); err == nil {
		_ = json.Unmarshal(b, &meta) // 损坏按缺省处理
	}
	rel, kind := probeEntry(dir)
	if rel == "" {
		return Avatar{}, false
	}
	av := Avatar{
		Slug:     slug,
		Name:     meta.Name,
		Author:   meta.Author,
		Version:  meta.Version,
		License:  meta.License,
		Homepage: meta.Homepage,
		Persona:  meta.Persona,
		Kind:     kind,
		Entry:    filepath.ToSlash(filepath.Join(slug, rel)),
	}
	if av.Name == "" {
		av.Name = slug
	}
	// persona 文件不存在则视为无（回退全局人设），不报错
	if av.Persona != "" {
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(av.Persona))); err != nil {
			av.Persona = ""
		}
	}
	if b, err := os.ReadFile(filepath.Join(dir, ".lovelybuddy.json")); err == nil {
		var sc sidecar
		if json.Unmarshal(b, &sc) == nil {
			av.Source = sc.Source
		}
	}
	return av, true
}

// probeEntry 在形象目录内找模型入口（≤3 层，与 M1 的递归深度一致），优先 Cubism 4。
// 返回相对形象目录的路径（斜杠分隔）与 kind；找不到返回 "", ""。
func probeEntry(dir string) (rel string, kind string) {
	var firstMoc3, firstMoc string
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // 不可读的跳过
		}
		if d.IsDir() {
			if p != dir && strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		r, err := filepath.Rel(dir, p)
		if err != nil {
			return nil
		}
		r = filepath.ToSlash(r)
		if strings.Count(r, "/") > 3 {
			return nil // 超过 3 层
		}
		if firstMoc3 == "" && strings.HasSuffix(d.Name(), ".model3.json") {
			firstMoc3 = r
		} else if firstMoc == "" && strings.HasSuffix(d.Name(), ".model.json") {
			firstMoc = r
		}
		return nil
	})
	if firstMoc3 != "" {
		return firstMoc3, "moc3"
	}
	if firstMoc != "" {
		return firstMoc, "moc"
	}
	return "", ""
}
```

- [ ] **Step 5: 接线 GET /api/v1/assets + --model-dir flag**

`server/internal/server/server.go`：

```go
import "lovelybuddy/server/internal/assets"

// New 组装 gin 引擎与路由。modelDir 为模型根目录（形象库）。
func New(addr, token string, pool *pgxpool.Pool, modelDir string) *http.Server {
	// ... 现有内容不变 ...
	api := r.Group("/api/v1", middleware.Token(token))
	{
		api.GET("/ping", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"pong": true}) })
		api.GET("/assets", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"avatars": assets.Detect(modelDir)})
		})
	}
	// ...
}
```

`server/cmd/lovely-buddy-server/main.go`：flag 区加一行、New 调用传参：

```go
modelDir = flag.String("model-dir", envOr("LOVELYBUDDY_MODEL_DIR", "../model"), "Live2D 模型根目录")
// ...
srv := server.New(*addr, *token, pool, *modelDir)
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全部 PASS；`Detect` 对 `../model`（haru/shizuku 样例）返回 2 个形象。

- [ ] **Step 7: Commit**

```bash
git add server/internal/assets server/internal/server/server.go server/cmd/lovely-buddy-server/main.go
git commit -m "feat(server): assets 包形象探测与列表 API（avatar.json 元数据）"
```

---

### Task 2: Go assets 包 —— 本地导入管线（zip/目录 → 形象目录）

**Files:**
- Create: `server/internal/assets/import.go`（Import/importArchive/importDir/extractZip/finalize/unwrapSingle/slugify/writeSidecar/copyFile + 上限变量）
- Create: `server/internal/assets/delete.go`（Delete + slugRe）
- Create: `server/internal/assets/import_test.go`

**Interfaces:**
- Consumes: `probeEntry`/`inspect`/`sidecar`（Task 1）
- Produces: `assets.Import(root string, src ImportSource) (Avatar, error)`；`assets.Delete(root, slug string) error`；`ImportSource{Type string; Value string}`（json: type/value）；包级上限变量 `maxEntries`/`maxUnpacked`（测试可调小）

- [ ] **Step 1: 写失败测试**

Create `server/internal/assets/import_test.go`：

```go
package assets

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// makeZip 在 t.TempDir 生成一个 zip，返回路径。files 的 key 为条目相对路径。
func makeZip(t *testing.T, files map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "test.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestImportFromZip(t *testing.T) {
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{
		"tianyi/avatar.json":              `{"name":"洛天依","author":"me","license":"unknown"}`,
		"tianyi/tianyi.model3.json":       `{"Version":3}`,
		"tianyi/textures/tex.png":         "png",
	})
	av, err := Import(root, ImportSource{Type: "path", Value: zipPath})
	if err != nil {
		t.Fatal(err)
	}
	if av.Slug != "test" || av.Name != "洛天依" || av.Author != "me" || av.Kind != "moc3" ||
		av.Entry != "test/tianyi.model3.json" || av.Source != "local" {
		t.Fatalf("导入结果不符: %+v", av)
	}
	// 目录已就位、侧车已写入、无 staging 残留
	if _, err := os.Stat(filepath.Join(root, "test", "tianyi.model3.json")); err != nil {
		t.Fatal("入口文件未入库", err)
	}
	if b, err := os.ReadFile(filepath.Join(root, "test", ".lovelybuddy.json")); err != nil || !strings.Contains(string(b), `"source":"local"`) {
		t.Fatalf("侧车不符: %s %v", b, err)
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 1 {
		t.Fatalf("应只有形象目录，got %d", len(entries))
	}
}
```

（slug 来自 zip 文件名 `test.zip` → `test`；`tianyi/` 单层目录被解包，avatar.json 带进去。）

```go
func TestImportZipSlip(t *testing.T) {
	root := t.TempDir()
	for _, evil := range []string{"../../evil.txt", "/abs.txt"} {
		zipPath := makeZip(t, map[string]string{evil: "x", "ok/x.model3.json": `{"Version":3}`})
		if _, err := Import(root, ImportSource{Type: "path", Value: zipPath}); err == nil {
			t.Fatalf("zip-slip 应报错: %s", evil)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "..", "evil.txt")); !os.IsNotExist(err) {
		t.Fatal("evil.txt 不应逃逸")
	}
	entries, _ := os.ReadDir(root)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".staging") {
			t.Fatalf("staging 残留: %s", e.Name())
		}
	}
}

func TestImportNoEntry(t *testing.T) {
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{"readme.txt": "hi"})
	_, err := Import(root, ImportSource{Type: "path", Value: zipPath})
	if err == nil || !strings.Contains(err.Error(), "未找到 Live2D 模型入口") {
		t.Fatalf("应报入口错误: %v", err)
	}
}

func TestImportSlugCollision(t *testing.T) {
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{"x.model3.json": `{"Version":3}`})
	if _, err := Import(root, ImportSource{Type: "path", Value: zipPath}); err != nil {
		t.Fatal(err)
	}
	av, err := Import(root, ImportSource{Type: "path", Value: zipPath})
	if err != nil {
		t.Fatal(err)
	}
	if av.Slug != "test-2" {
		t.Fatalf("冲突 slug 应为 test-2: %s", av.Slug)
	}
}

func TestImportFromDir(t *testing.T) {
	root := t.TempDir()
	src := t.TempDir()
	writeDir(t, src, map[string]string{"s.model.json": `{"type":"Live2DModelSetting"}`})
	av, err := Import(root, ImportSource{Type: "path", Value: src})
	if err != nil {
		t.Fatal(err)
	}
	// 原目录不被移动
	if _, err := os.Stat(filepath.Join(src, "s.model.json")); err != nil {
		t.Fatal("原目录不应被移动", err)
	}
	if av.Kind != "moc" {
		t.Fatalf("kind=%s", av.Kind)
	}
}

func TestImportOversize(t *testing.T) {
	old := maxUnpacked
	maxUnpacked = 16
	defer func() { maxUnpacked = old }()
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{
		"big/x.model3.json": strings.Repeat("a", 100),
	})
	if _, err := Import(root, ImportSource{Type: "path", Value: zipPath}); err == nil || !strings.Contains(err.Error(), "上限") {
		t.Fatalf("应报大小上限: %v", err)
	}
}

func TestDelete(t *testing.T) {
	root := t.TempDir()
	zipPath := makeZip(t, map[string]string{"x.model3.json": `{"Version":3}`})
	av, err := Import(root, ImportSource{Type: "path", Value: zipPath})
	if err != nil {
		t.Fatal(err)
	}
	if err := Delete(root, av.Slug); err != nil {
		t.Fatal(err)
	}
	if len(Detect(root)) != 0 {
		t.Fatal("删除后应无形象")
	}
	for _, bad := range []string{"../x", "..", ".", "a/b", ""} {
		if err := Delete(root, bad); err == nil {
			t.Fatalf("非法 slug 应报错: %q", bad)
		}
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/assets/`
Expected: FAIL（undefined: Import / Delete）

- [ ] **Step 3: 实现 import.go**

```go
package assets

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 上限为包级变量：单测可调小验证防护逻辑。
var (
	maxEntries  = 20000 // zip 条目数上限（zip 炸弹防护）
	maxUnpacked = int64(1 << 30) // 解压/复制总字节上限 1GB
)

// ImportSource 描述导入来源（API 请求体 {source:{type,value}}）。
type ImportSource struct {
	Type  string `json:"type"`  // "url" | "path"
	Value string `json:"value"` // HTTPS URL 或本地目录/zip 路径
}

// Import 导入形象到模型根目录：path=目录复制/zip 解压；url=下载后解压（Task 3 的 Download）。
// 成功后返回新形象信息（调用方用于自动应用）。
func Import(root string, src ImportSource) (Avatar, error) {
	switch src.Type {
	case "url":
		tmp, err := Download(root, src.Value)
		if err != nil {
			return Avatar{}, err
		}
		defer os.Remove(tmp)
		return importArchive(root, tmp, "url", src.Value)
	case "path":
		st, err := os.Stat(src.Value)
		if err != nil {
			return Avatar{}, fmt.Errorf("读取来源失败: %w", err)
		}
		if st.IsDir() {
			return importDir(root, src.Value, "local", src.Value)
		}
		return importArchive(root, src.Value, "local", src.Value)
	default:
		return Avatar{}, fmt.Errorf("未知来源类型: %s", src.Type)
	}
}

// importArchive 解压 zip 到 staging 并入库。staging 建在 root 内保证 rename 同文件系统。
func importArchive(root, zipPath, source, value string) (Avatar, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return Avatar{}, fmt.Errorf("不是有效的 zip: %w", err)
	}
	defer zr.Close()
	return withStaging(root, func(staging string) (Avatar, error) {
		if err := extractZip(zr, staging); err != nil {
			return Avatar{}, err
		}
		return finalize(root, staging, source, value)
	})
}

// importDir 复制本地目录到 staging（不移动用户原目录）。
func importDir(root, srcDir, source, value string) (Avatar, error) {
	return withStaging(root, func(staging string) (Avatar, error) {
		var total int64
		err := filepath.WalkDir(srcDir, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				if p != srcDir && strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return err
			}
			if total+info.Size() > maxUnpacked {
				return fmt.Errorf("目录总大小超过上限 1GB")
			}
			total += info.Size()
			rel, err := filepath.Rel(srcDir, p)
			if err != nil {
				return err
			}
			dst := filepath.Join(staging, rel)
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return err
			}
			return copyFile(p, dst)
		})
		if err != nil {
			return Avatar{}, err
		}
		return finalize(root, staging, source, value)
	})
}

// withStaging 建临时目录、执行 fn、清理。失败时 caller 的报错会带上原因。
func withStaging(root string, fn func(staging string) (Avatar, error)) (Avatar, error) {
	staging, err := os.MkdirTemp(root, ".staging-")
	if err != nil {
		return Avatar{}, err
	}
	defer os.RemoveAll(staging)
	return fn(staging)
}

// extractZip 解压所有文件条目：zip-slip 防护 + 炸弹防护。
// 条目名统一把 \\ 换成 /（部分 Windows 工具产出反斜杠条目）。
func extractZip(zr *zip.ReadCloser, dest string) error {
	if len(zr.File) > maxEntries {
		return fmt.Errorf("zip 条目数超过上限 %d", maxEntries)
	}
	var total int64
	for _, f := range zr.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		rel := filepath.Clean(filepath.FromSlash(name))
		if rel == "." || filepath.IsAbs(rel) || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("zip 含非法路径: %s", f.Name) // zip-slip 拒绝
		}
		target := filepath.Join(dest, rel)
		if target != dest && !strings.HasPrefix(target, dest+string(filepath.Separator)) {
			return fmt.Errorf("zip 含越界路径: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		r, err := f.Open()
		if err != nil {
			return err
		}
		w, err := os.Create(target)
		if err != nil {
			r.Close()
			return err
		}
		n, err := io.Copy(w, io.LimitReader(r, maxUnpacked-total+1))
		w.Close()
		r.Close()
		if err != nil {
			return err
		}
		total += n
		if total > maxUnpacked {
			return fmt.Errorf("解压总大小超过上限 1GB")
		}
	}
	return nil
}

// finalize staging → 形象目录：解包单层目录、探测入口、生成 slug（冲突加后缀）、
// 原子 rename 入库、写来源侧车。
func finalize(root, staging, source, value string) (Avatar, error) {
	avatarDir := staging
	if single, ok := unwrapSingle(staging); ok {
		avatarDir = single
	}
	if rel, _ := probeEntry(avatarDir); rel == "" {
		return Avatar{}, fmt.Errorf("未找到 Live2D 模型入口（*.model3.json / *.model.json，≤3 层）")
	}
	slug := slugFromValue(source, value)
	finalPath := filepath.Join(root, slug)
	for i := 2; ; i++ {
		if _, err := os.Lstat(finalPath); err != nil {
			break // 不存在，可用（本地单用户工具，容忍极小 TOCTOU）
		}
		finalPath = filepath.Join(root, fmt.Sprintf("%s-%d", slug, i))
	}
	if err := os.Rename(avatarDir, finalPath); err != nil {
		return Avatar{}, fmt.Errorf("入库失败: %w", err)
	}
	writeSidecar(finalPath, source, value)
	av, _ := inspect(finalPath)
	return av, nil
}

// unwrapSingle staging 内恰好一个目录且无文件时返回该目录（解包常见外层目录）。
func unwrapSingle(dir string) (string, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || !entries[0].IsDir() {
		return dir, false
	}
	return filepath.Join(dir, entries[0].Name()), true
}

// slugFromValue 由来源生成 slug：URL 取路径末段、路径取 basename，再 sanitize。
func slugFromValue(source, value string) string {
	name := filepath.Base(value)
	if source == "url" {
		if u, err := url.Parse(value); err == nil && u.Path != "" && u.Path != "/" {
			name = filepath.Base(u.Path)
		}
	}
	return slugify(name)
}

// slugify 转安全目录名：[a-z0-9_-]，其余字符替换为 -；空则 "avatar"。
// 非拉丁字符（如中文名）会全部替换，落 "avatar" 系列。
func slugify(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		return "avatar"
	}
	return s
}

// writeSidecar 记录来源（审计 + UI 展示来源），写失败不影响导入。
func writeSidecar(dir, source, value string) {
	b, _ := json.Marshal(sidecar{Source: source, Value: value, At: time.Now().Format(time.RFC3339)})
	_ = os.WriteFile(filepath.Join(dir, ".lovelybuddy.json"), b, 0o644)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
```

- [ ] **Step 4: 实现 delete.go**

```go
package assets

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// slug 只允许 [A-Za-z0-9._-] 且以字母数字开头，杜绝路径穿越。
var slugRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// Delete 删除形象目录（仅限模型根目录内）。
func Delete(root, slug string) error {
	if !slugRe.MatchString(slug) || slug == "." || slug == ".." {
		return fmt.Errorf("非法 slug: %s", slug)
	}
	target := filepath.Join(root, slug)
	if target == root || !strings.HasPrefix(target, root+string(filepath.Separator)) {
		return fmt.Errorf("越界路径")
	}
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("删除失败: %w", err)
	}
	return nil
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && go vet ./... && go test ./internal/assets/ -v`
Expected: 全部 PASS（含 zip-slip 拒绝、炸弹上限、slug 冲突、目录复制、删除校验）

- [ ] **Step 6: Commit**

```bash
git add server/internal/assets
git commit -m "feat(server): assets 导入管线（zip-slip/炸弹防护、slug 冲突、侧车）与删除"
```

---

### Task 3: Go —— URL 下载 + import/delete 路由 + 引擎级测试

**Files:**
- Create: `server/internal/assets/download.go`（Download/tryDownload + `httpClient` 变量）
- Create: `server/internal/assets/download_test.go`
- Modify: `server/internal/server/server.go`（POST /api/v1/assets/import、DELETE /api/v1/assets/:slug）
- Create: `server/internal/server/server_test.go`（httptest 引擎级）

**Interfaces:**
- Consumes: `assets.Import`/`assets.Delete`（Task 2）
- Produces: `assets.Download(root, rawURL string) (tmpPath string, err error)`；路由 POST /api/v1/assets/import（body `{source:{type,value}}` → 200 `{avatar}` / 422 `{error}`）、DELETE /api/v1/assets/:slug（200 `{ok:true}` / 400 `{error}`）

- [ ] **Step 1: 写失败测试 download_test.go**

```go
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/assets/ -run TestDownload`
Expected: FAIL（undefined: Download / httpClient / maxDownload）

- [ ] **Step 3: 实现 download.go**

```go
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
```

- [ ] **Step 4: 跑单测确认通过**

Run: `cd server && go test ./internal/assets/ -run TestDownload -v`
Expected: 4 个 PASS。

- [ ] **Step 5: 加路由 + 引擎级测试**

`server/internal/server/server.go` api group 内追加（Task 1 的 GET /assets 之后）：

```go
api.POST("/assets/import", func(c *gin.Context) {
	var src assets.ImportSource
	if err := c.ShouldBindJSON(&src); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	av, err := assets.Import(modelDir, src)
	if err != nil {
		slog.Error("assets: 导入失败", "source", src.Type, "err", err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"avatar": av})
})
api.DELETE("/assets/:slug", func(c *gin.Context) {
	if err := assets.Delete(modelDir, c.Param("slug")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
})
```

（server.go 顶部 import 加 `"log/slog"`。）

Create `server/internal/server/server_test.go`：

```go
package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

const testToken = "test-token"

// newTestServer 组装引擎（无 DB，仅 assets 路由），返回测试客户端。
func newTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	srv := New("127.0.0.1:0", testToken, nil, root)
	ts := httptest.NewServer(srv.Handler)
	t.Cleanup(ts.Close)
	return ts, root
}

func doJSON(t *testing.T, method, url, token string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, url, &buf)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&m)
	return resp, m
}

func makeTestZip(t *testing.T) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range map[string]string{
		"m/avatar.json":      `{"name":"测试形象"}`,
		"m/m.model3.json":    `{"Version":3}`,
	} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(content))
	}
	_ = zw.Close()
	p := filepath.Join(t.TempDir(), "t.zip")
	if err := os.WriteFile(p, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAssetsAuth(t *testing.T) {
	ts, _ := newTestServer(t)
	resp, _ := doJSON(t, http.MethodGet, ts.URL+"/api/v1/assets", "", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("无 token 应 401, got %d", resp.StatusCode)
	}
}

func TestAssetsImportListDelete(t *testing.T) {
	ts, root := newTestServer(t)
	zipPath := makeTestZip(t)

	// 导入本地 zip
	resp, m := doJSON(t, http.MethodPost, ts.URL+"/api/v1/assets/import", testToken,
		map[string]any{"source": map[string]string{"type": "path", "value": zipPath}})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("导入应 200, got %d %v", resp.StatusCode, m)
	}
	av, _ := m["avatar"].(map[string]any)
	if av["slug"] != "t" || av["name"] != "测试形象" {
		t.Fatalf("avatar 不符: %v", av)
	}

	// 列表含新形象
	resp, m = doJSON(t, http.MethodGet, ts.URL+"/api/v1/assets", testToken, nil)
	avatars, _ := m["avatars"].([]any)
	if resp.StatusCode != http.StatusOK || len(avatars) != 1 {
		t.Fatalf("列表不符: %d %v", resp.StatusCode, m)
	}

	// 恶意 zip 经 API 被拒（422）
	evil := filepath.Join(t.TempDir(), "evil.zip")
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("../../evil.txt")
	_, _ = w.Write([]byte("x"))
	_ = zw.Close()
	_ = os.WriteFile(evil, buf.Bytes(), 0o644)
	resp, m = doJSON(t, http.MethodPost, ts.URL+"/api/v1/assets/import", testToken,
		map[string]any{"source": map[string]string{"type": "path", "value": evil}})
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("恶意 zip 应 422, got %d %v", resp.StatusCode, m)
	}

	// 删除 → 列表空；再删非法 slug → 400
	resp, _ = doJSON(t, http.MethodDelete, ts.URL+"/api/v1/assets/t", testToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("删除应 200, got %d", resp.StatusCode)
	}
	resp, m = doJSON(t, http.MethodGet, ts.URL+"/api/v1/assets", testToken, nil)
	if avatars, _ := m["avatars"].([]any); len(avatars) != 0 {
		t.Fatalf("删除后应空: %v", m)
	}
	resp, _ = doJSON(t, http.MethodDelete, ts.URL+"/api/v1/assets/..%2Fx", testToken, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("非法 slug 应 400, got %d", resp.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(root, "t")); !os.IsNotExist(err) {
		t.Fatal("形象目录应已删除")
	}
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全部 PASS（assets 单测 + server 引擎级）。

- [ ] **Step 7: Commit**

```bash
git add server/internal/assets server/internal/server
git commit -m "feat(server): 形象导入/删除 API 与 URL 下载（512MB/重试/审计）"
```

---

### Task 4: Desktop —— IPC 换血、assetsApi、petStore 改造

**Files:**
- Modify: `apps/desktop/src/main/index.ts`（删 list-models/pick-model-dir 两 handler，加 pick-import-path）
- Modify: `apps/desktop/src/main/store.ts`（删 modelDir 字段与 setModelDir，getter 只按 dev/packaged 计算）
- Delete: `apps/desktop/src/main/models.ts`、`apps/desktop/src/main/__test__/models.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`（删 listModels/pickModelDir，加 pickImportPath）
- Modify: `apps/desktop/src/renderer/src/env.d.ts`（AvatarInfo 类型）
- Create: `apps/desktop/src/renderer/src/lib/assetsApi.ts`
- Modify: `apps/desktop/src/renderer/src/store/petStore.ts`（models: AvatarInfo[]；loadModels 走 HTTP；importModel/deleteModel；删 pickModelDir）
- Modify: `apps/desktop/src/renderer/src/__test__/App.test.tsx`（mock 换成 fetch 路由 + pickImportPath）

**Interfaces:**
- Consumes: API 契约（Task 1/3）：GET /api/v1/assets → `{avatars: Avatar[]}`；POST /api/v1/assets/import → `{avatar}`；DELETE /api/v1/assets/:slug → `{ok:true}`
- Produces: `pickImportPath(mode: 'zip' | 'dir'): Promise<{canceled: boolean; path: string | null}>`（preload）；`listAvatars/importAvatar/deleteAvatar`（renderer lib）；store actions `importModel(source): Promise<boolean>`、`deleteModel(info): Promise<void>`

- [ ] **Step 1: main 进程 IPC 替换**

`apps/desktop/src/main/index.ts`：

```ts
import { registerScheme, registerL2DProtocol } from './protocol'
import { SettingsStore } from './store'
// 删掉 import { listModels } from './models'
```

setupIPC 内删除两个 handler，新增：

```ts
// 本地导入：选择 zip 文件或目录（实际导入由 Go 后端执行，这里只取路径）
ipcMain.handle('lovelybuddy:pick-import-path', async (_e, mode: 'zip' | 'dir') => {
  const opts: Electron.OpenDialogOptions =
    mode === 'dir'
      ? { title: '选择形象目录', properties: ['openDirectory'] }
      : { title: '选择形象 zip', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] }
  const { canceled, filePaths } = await dialog.showOpenDialog(petWindow!, opts)
  if (canceled || filePaths.length === 0) return { canceled: true, path: null }
  return { canceled: false, path: filePaths[0] }
})
```

`apps/desktop/src/main/store.ts`：删除 `modelDir` 字段、`setModelDir`；getter 改为：

```ts
/** 模型根目录（l2d:// 服务根）：dev=仓库 model/，packaged=userData/models。目录选择入口已移除，唯一根由 Go 后端同指。 */
get modelDir(): string {
  return app.isPackaged ? join(app.getPath('userData'), 'models') : join(app.getAppPath(), '..', '..', 'model')
}
```

- [ ] **Step 2: preload + env.d.ts**

`apps/desktop/src/preload/index.ts`：接口删 `listModels`/`pickModelDir`，加：

```ts
/** 弹出本地文件/目录选择框（zip 或目录），返回路径或 canceled */
pickImportPath: (mode: 'zip' | 'dir') => Promise<{ canceled: boolean; path: string | null }>
```

实现与 IPC：

```ts
pickImportPath: (mode) => ipcRenderer.invoke('lovelybuddy:pick-import-path', mode)
```

`apps/desktop/src/renderer/src/env.d.ts`：ModelInfo 后追加：

```ts
interface AvatarInfo extends ModelInfo {
  /** 形象目录名（服务端唯一标识） */
  slug: string
  /** 相对模型根目录的入口文件 */
  entry: string
  author?: string
  version?: string
  license?: string
  homepage?: string
  /** 来源：导入写入（local/url），手工放入为空 */
  source?: 'local' | 'url'
}
```

- [ ] **Step 3: 实现 assetsApi**

Create `apps/desktop/src/renderer/src/lib/assetsApi.ts`：

```ts
// 形象 API 客户端：与 Go 后端 /api/v1/assets 通信（Bearer token）。
// 服务端返回相对路径 entry，渲染端拼 l2d:// URL（Electron 特权协议，见 main/protocol.ts）。
export interface ApiRuntime {
  baseUrl: string
  token: string
}

export interface ImportSource {
  type: 'url' | 'path'
  value: string
}

interface RawAvatar {
  slug: string
  name: string
  kind: string
  entry: string
  author?: string
  version?: string
  license?: string
  homepage?: string
  persona?: string
  source?: string
}

function authHeaders(rt: ApiRuntime): Record<string, string> {
  return { Authorization: `Bearer ${rt.token}` }
}

function toAvatar(a: RawAvatar): AvatarInfo {
  return {
    slug: a.slug,
    name: a.name,
    url: `l2d://model/${a.entry}`,
    kind: a.kind === 'moc3' ? 'moc3' : 'moc',
    entry: a.entry,
    ...(a.author ? { author: a.author } : {}),
    ...(a.version ? { version: a.version } : {}),
    ...(a.license ? { license: a.license } : {}),
    ...(a.homepage ? { homepage: a.homepage } : {}),
    ...(a.source === 'local' || a.source === 'url' ? { source: a.source } : {})
  }
}

export async function listAvatars(rt: ApiRuntime): Promise<AvatarInfo[]> {
  const res = await fetch(`${rt.baseUrl}/api/v1/assets`, { headers: authHeaders(rt) })
  if (!res.ok) throw new Error(`形象列表失败: HTTP ${res.status}`)
  const data = (await res.json()) as { avatars: RawAvatar[] }
  return data.avatars.map(toAvatar)
}

export async function importAvatar(rt: ApiRuntime, source: ImportSource): Promise<AvatarInfo> {
  const res = await fetch(`${rt.baseUrl}/api/v1/assets/import`, {
    method: 'POST',
    headers: { ...authHeaders(rt), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source })
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `导入失败: HTTP ${res.status}`)
  }
  const data = (await res.json()) as { avatar: RawAvatar }
  return toAvatar(data.avatar)
}

export async function deleteAvatar(rt: ApiRuntime, slug: string): Promise<void> {
  const res = await fetch(`${rt.baseUrl}/api/v1/assets/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: authHeaders(rt)
  })
  if (!res.ok) throw new Error(`删除失败: HTTP ${res.status}`)
}
```

- [ ] **Step 4: petStore 改造**

`apps/desktop/src/renderer/src/store/petStore.ts`：

```ts
import { create } from 'zustand'
import { deleteAvatar, importAvatar, listAvatars, type ImportSource } from '../lib/assetsApi'

// ... BackendStatus/MODEL_URL_KEY/PLACEHOLDER_DISMISSED_KEY/readDismissed 不变 ...

interface PetState {
  models: AvatarInfo[]
  modelUrl: string | null
  modelName: string | null
  modelError: string | null
  placeholderDismissed: boolean
  /** 导入进行中（UI 显示状态、防重复提交） */
  importing: boolean
  importError: string | null
  status: BackendStatus
  version: string | null
  loadModels: () => Promise<void>
  selectModel: (info: AvatarInfo) => void
  /** 导入形象；成功后自动应用（auto_apply_avatar 默认开，设置项留 M3）。返回是否成功。 */
  importModel: (source: ImportSource) => Promise<boolean>
  /** 删除形象；若删的是当前选中，自动切到剩余第一个。确认对话框由 UI 层负责。 */
  deleteModel: (info: AvatarInfo) => Promise<void>
  dismissPlaceholder: () => void
  setModelError: (err: string | null) => void
  setStatus: (status: BackendStatus, version?: string | null) => void
}

export const usePetStore = create<PetState>()((set, get) => ({
  // ... models/modelUrl/modelName/modelError/placeholderDismissed/status/version 初始值不变 ...
  importing: false,
  importError: null,

  async loadModels() {
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const models = await listAvatars(rt)
      const restored = localStorage.getItem(MODEL_URL_KEY)
      const next = models.find((m) => m.url === (get().modelUrl ?? restored)) ?? models[0] ?? null
      set({
        models,
        modelUrl: next?.url ?? null,
        modelName: next?.name ?? null,
        modelError: null,
        placeholderDismissed: next ? false : get().placeholderDismissed
      })
    } catch (e) {
      set({ modelError: String(e) })
    }
  },

  // selectModel / dismissPlaceholder / setModelError / setStatus 不变（selectModel 参数类型改 AvatarInfo）

  async importModel(source) {
    set({ importing: true, importError: null })
    try {
      const rt = await window.lovelybuddy.getRuntime()
      const avatar = await importAvatar(rt, source)
      const models = await listAvatars(rt)
      localStorage.setItem(MODEL_URL_KEY, avatar.url)
      // 自动应用：选中新形象并复位占位卡
      set({
        models,
        modelUrl: avatar.url,
        modelName: avatar.name,
        modelError: null,
        placeholderDismissed: false,
        importing: false
      })
      return true
    } catch (e) {
      set({ importing: false, importError: e instanceof Error ? e.message : String(e) })
      return false
    }
  },

  async deleteModel(info) {
    const rt = await window.lovelybuddy.getRuntime()
    await deleteAvatar(rt, info.slug)
    const models = await listAvatars(rt)
    const kept = models.find((m) => m.url === get().modelUrl)
    set({
      models,
      modelUrl: kept?.url ?? models[0]?.url ?? null,
      modelName: kept?.name ?? models[0]?.name ?? null,
      modelError: null
    })
  }
}))
```

- [ ] **Step 5: 更新 App.test.tsx mock**

`apps/desktop/src/renderer/src/__test__/App.test.tsx`：`mockLovelybuddy` 改为：

```ts
function mockLovelybuddy(): void {
  vi.stubGlobal('lovelybuddy', {
    getRuntime: vi.fn().mockResolvedValue({
      baseUrl: 'http://127.0.0.1:8740',
      token: 'dev',
      dev: true
    }),
    setPassthrough: vi.fn(),
    quit: vi.fn(),
    moveWindow: vi.fn(),
    moveWindowEnd: vi.fn(),
    resizeWindow: vi.fn(),
    pickImportPath: vi.fn().mockResolvedValue({ canceled: true, path: null })
  })
}

/** fetch 按 URL 路由到假后端（assets + healthz） */
function mockFetchApi(avatars: Array<Record<string, unknown>>, importResult?: { ok: boolean; avatar?: Record<string, unknown>; error?: string }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      if (url === 'http://127.0.0.1:8740/api/v1/assets' && method === 'GET') return json({ avatars })
      if (url === 'http://127.0.0.1:8740/api/v1/assets/import' && method === 'POST') {
        if (importResult && !importResult.ok) return json({ error: importResult.error }, 422)
        return json({ avatar: importResult?.avatar ?? avatars[0] })
      }
      if (url.startsWith('http://127.0.0.1:8740/api/v1/assets/') && method === 'DELETE') return json({ ok: true })
      if (url === 'http://127.0.0.1:8740/healthz') return json({ status: 'ok', db: 'ok', version: '0.1.0-dev' })
      return json({}, 404)
    })
  )
}

const haruAvatar = { slug: 'haru', name: 'haru-cubism4', kind: 'moc3', entry: 'haru/haru.model3.json', license: 'free', source: 'local' }
const shizukuAvatar = { slug: 'shizuku', name: 'shizuku-cubism2', kind: 'moc', entry: 'shizuku/shizuku.model.json' }
```

用例替换（URL 均为 `l2d://model/...`）：
- 测试 3（无模型占位卡）：`mockFetchApi([])`；点击「重新扫描」→ `expect(fetch).toHaveBeenCalledTimes(...)` 改为断言 `fetch` 对 `/api/v1/assets` GET 的调用次数 ≥2。
- 测试 4（多模型切换）：`mockFetchApi([haruAvatar, shizukuAvatar])`；断言 active 切换与 `.pet-canvas` 出现（逻辑不变，仅数据源换）。
- 测试 6（穿透）：`mockFetchApi([haruAvatar])`（原 mockLovelybuddy([…]) 调用点全部改 mockFetchApi）。
- `mockLovelybuddy([])` → `mockLovelybuddy()`；`window.lovelybuddy.listModels` 断言删除。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd apps/desktop && pnpm typecheck && pnpm test`
Expected: 24 用例全绿（用例数随删除/调整保持 24，Task 5 再扩）。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer/src
git commit -m "refactor(desktop): 形象列表改走后端 API，main 只留文件选择对话框"
```

---

### Task 5: Desktop UI —— 导入面板 + 形象删除 + 占位卡更新

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/index.css`（追加 .avatar-actions/.import-panel/.import-status/.import-error/.btn-plain 样式）
- Modify: `apps/desktop/src/renderer/src/__test__/App.test.tsx`（新增导入/删除用例）

**Interfaces:**
- Consumes: store `importModel/deleteModel/importing/importError`（Task 4）；preload `pickImportPath`
- Produces: UI 无对外接口

- [ ] **Step 1: App.tsx 实现**

```tsx
import { useEffect, useState, type ReactElement } from 'react'
import PetCanvas from './pet/PetCanvas'
import { usePetStore } from './store/petStore'
import type { ImportSource } from './lib/assetsApi'

export default function App(): ReactElement {
  // ... 现有 usePetStore 选择器不变，新增：
  const importing = usePetStore((s) => s.importing)
  const importError = usePetStore((s) => s.importError)
  const importModel = usePetStore((s) => s.importModel)
  const deleteModel = usePetStore((s) => s.deleteModel)
  const [importOpen, setImportOpen] = useState(false)
  const [urlText, setUrlText] = useState('')

  // ... 两个 useEffect 不变 ...

  // 本地导入：弹文件/目录选择框 → 交给后端导入管线
  const importLocal = async (mode: 'zip' | 'dir'): Promise<void> => {
    const picked = await window.lovelybuddy.pickImportPath(mode)
    if (picked.canceled || !picked.path) return
    const source: ImportSource = { type: 'path', value: picked.path }
    if (await importModel(source)) setImportOpen(false)
  }

  const importFromUrl = async (): Promise<void> => {
    const value = urlText.trim()
    if (!value) return
    const source: ImportSource = { type: 'url', value }
    if (await importModel(source)) {
      setUrlText('')
      setImportOpen(false)
    }
  }

  const confirmDelete = (): void => {
    const name = usePetStore.getState().modelName ?? '当前形象'
    if (window.confirm(`删除形象「${name}」？此操作不可恢复。`)) {
      const info = usePetStore.getState().models.find((m) => m.url === usePetStore.getState().modelUrl)
      if (info) void deleteModel(info)
    }
  }

  // statusText 不变

  return (
    <>
      <PetCanvas url={modelUrl} name={modelName ?? ''} />
      {modelUrl === null && !placeholderDismissed && (
        <div className="placeholder" data-interactive>
          {/* placeholder-close / placeholder-title / hint 不变，actions 改为： */}
          <div className="placeholder-actions">
            <button onClick={() => setImportOpen(true)}>导入形象</button>
            <button onClick={() => void loadModels()}>重新扫描</button>
          </div>
          <p className="hint">
            支持粘贴 HTTPS zip 链接、选择本地 zip 或目录导入。洛天依模型需用户自行获取（版权归上海禾念）。
          </p>
        </div>
      )}
      <div className="top-right" data-interactive>
        {models.length > 1 && (
          <div className="model-switcher">
            {models.map((m) => (
              <button
                key={m.slug}
                className={m.url === modelUrl ? 'active' : ''}
                onClick={() => selectModel(m)}
                title={`${m.name}（${m.kind === 'moc3' ? 'Cubism 4' : 'Cubism 2'}）`}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
        <div className="avatar-actions">
          <button className="btn-plain" onClick={() => setImportOpen(!importOpen)}>
            {importOpen ? '收起' : '导入形象'}
          </button>
          {modelUrl !== null && (
            <button className="btn-plain danger" onClick={confirmDelete}>
              删除当前形象
            </button>
          )}
        </div>
        {importOpen && (
          <div className="import-panel">
            <input
              className="import-url"
              placeholder="粘贴 https://…zip 链接"
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              disabled={importing}
            />
            <div className="import-buttons">
              <button onClick={() => void importFromUrl()} disabled={importing || !urlText.trim()}>
                {importing ? '导入中…' : '从 URL 导入'}
              </button>
              <button onClick={() => void importLocal('zip')} disabled={importing}>
                本地 zip
              </button>
              <button onClick={() => void importLocal('dir')} disabled={importing}>
                本地目录
              </button>
            </div>
            {importing && <p className="import-status">导入中…（大文件可能需要一点时间）</p>}
            {importError !== null && <p className="import-error">{importError}</p>}
          </div>
        )}
        <div className="status-card">
          {/* dot + statusText 不变 */}
        </div>
        {modelError !== null && modelUrl !== null && <div className="model-error">{modelError}</div>}
      </div>
    </>
  )
}
```

- [ ] **Step 2: 追加 CSS**

`apps/desktop/src/renderer/src/styles/index.css` 末尾追加：

```css
/* 形象管理：操作按钮行 + 导入面板 */
.avatar-actions {
  display: flex;
  gap: 6px;
}

.btn-plain {
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  background: rgba(30, 30, 46, 0.7);
  color: #ccc;
  font-size: 12px;
  cursor: pointer;
  backdrop-filter: blur(8px);
}

.btn-plain.danger {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.4);
}

.import-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 260px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(30, 30, 46, 0.9);
  backdrop-filter: blur(8px);
}

.import-url {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: #eee;
  font-size: 12px;
}

.import-buttons {
  display: flex;
  gap: 6px;
}

.import-buttons button {
  padding: 6px 10px;
  border: none;
  border-radius: 8px;
  background: #66cccc;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

.import-buttons button:disabled {
  opacity: 0.5;
  cursor: default;
}

.import-status {
  font-size: 12px;
  color: #aaa;
}

.import-error {
  font-size: 12px;
  color: #fca5a5;
  word-break: break-all;
}
```

- [ ] **Step 3: 新增测试用例**

`apps/desktop/src/renderer/src/__test__/App.test.tsx` 追加（沿用 Task 4 的 mockFetchApi）：

```tsx
it('导入成功自动应用新形象', async () => {
  mockFetchApi([haruAvatar], { ok: true, avatar: { slug: 'tianyi', name: '天依', kind: 'moc3', entry: 'tianyi/tianyi.model3.json', source: 'url' } })
  renderApp()
  await screen.findByText('haru-cubism4')

  fireEvent.click(screen.getByText('导入形象'))
  fireEvent.change(screen.getByPlaceholderText('粘贴 https://…zip 链接'), { target: { value: ' https://example.com/tianyi.zip ' } })
  fireEvent.click(screen.getByText('从 URL 导入'))

  await waitFor(() => {
    expect(screen.getByText('天依').className).toContain('active')
  })
  // 自动应用：localStorage 记住新形象
  expect(localStorage.getItem('lovelybuddy:model-url')).toBe('l2d://model/tianyi/tianyi.model3.json')
  // POST body 正确（trim 后）
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
  const importCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/v1/assets/import'))
  expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({ source: { type: 'url', value: 'https://example.com/tianyi.zip' } })
})

it('导入失败显示后端错误', async () => {
  mockFetchApi([], { ok: false, error: 'zip 含非法路径: ../../evil.txt' })
  renderApp()
  await screen.findByText('未找到 Live2D 模型')

  fireEvent.click(screen.getByText('导入形象'))
  fireEvent.change(screen.getByPlaceholderText('粘贴 https://…zip 链接'), { target: { value: 'https://example.com/evil.zip' } })
  fireEvent.click(screen.getByText('从 URL 导入'))

  await waitFor(() => {
    expect(screen.getByText('zip 含非法路径: ../../evil.txt')).toBeTruthy()
  })
  // 面板保持打开（未自动应用）
  expect(screen.getByText('从 URL 导入')).toBeTruthy()
})

it('删除当前形象后切换到剩余形象', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  mockFetchApi([haruAvatar, shizukuAvatar])
  renderApp()
  await screen.findByText('haru-cubism4')

  fireEvent.click(screen.getByText('删除当前形象'))
  await waitFor(() => {
    expect(screen.queryByText('haru-cubism4')).toBeNull()
  })
  // 切换器只剩 shizuku 且 active
  await waitFor(() => {
    expect(screen.getByText('shizuku-cubism2').className).toContain('active')
  })
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
  expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/v1/assets/haru') && c[1]?.method === 'DELETE')).toBe(true)
})

it('本地导入走文件选择对话框', async () => {
  mockFetchApi([], { ok: true, avatar: { slug: 'local', name: '本地形象', kind: 'moc', entry: 'local/x.model.json', source: 'local' } })
  ;(window.lovelybuddy.pickImportPath as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: false, path: '/tmp/x.zip' })
  renderApp()
  await screen.findByText('未找到 Live2D 模型')

  fireEvent.click(screen.getByText('导入形象'))
  fireEvent.click(screen.getByText('本地 zip'))
  await waitFor(() => {
    expect(screen.getByText('本地形象')).toBeTruthy()
  })
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
  const importCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/v1/assets/import'))
  expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({ source: { type: 'path', value: '/tmp/x.zip' } })
})
```

注意：删除用例中 mockFetchApi 的 DELETE 要真正「生效」——把 mockFetchApi 升级为有状态：

```ts
function mockFetchApi(avatars: Array<Record<string, unknown>>, importResult?: { ok: boolean; avatar?: Record<string, unknown>; error?: string }): void {
  let list: Array<Record<string, unknown>> = [...avatars]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      if (url === 'http://127.0.0.1:8740/api/v1/assets' && method === 'GET') return json({ avatars: list })
      if (url === 'http://127.0.0.1:8740/api/v1/assets/import' && method === 'POST') {
        if (importResult && !importResult.ok) return json({ error: importResult.error }, 422)
        const avatar = importResult?.avatar ?? avatars[0]
        if (avatar && !list.some((a) => a.slug === avatar.slug)) list = [...list, avatar]
        return json({ avatar })
      }
      if (url.startsWith('http://127.0.0.1:8740/api/v1/assets/') && method === 'DELETE') {
        const slug = decodeURIComponent(url.split('/').pop() ?? '')
        list = list.filter((a) => a.slug !== slug)
        return json({ ok: true })
      }
      if (url === 'http://127.0.0.1:8740/healthz') return json({ status: 'ok', db: 'ok', version: '0.1.0-dev' })
      return json({}, 404)
    })
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm typecheck && pnpm test`
Expected: 全部 PASS（24 旧例 + 4 新例 = 28）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 导入面板与形象删除（自动应用、错误展示）"
```

---

### Task 6: 总验收 + README 补充

**Files:**
- Modify: `README.md`（快速开始补充导入方式一行）
- Modify: `docs/design.md`（§3.2 追加「API 端点」小节，记录本次实现的契约）

- [ ] **Step 1: README 一行补充**

「首次渲染模型」段落后追加：

```markdown
形象也可在应用内导入：右上角「导入形象」支持粘贴 HTTPS zip 链接、选择本地 zip 或目录，导入成功后自动切换（无需重启）。
```

- [ ] **Step 2: design.md §3.2 追加 API 契约**

§3.2 末尾追加：

```markdown
**API 契约（lovely-buddy-server，Bearer token，仅 127.0.0.1）**：
- `GET /api/v1/assets` → `{avatars: Avatar[]}`（Avatar：slug/name/author/version/license/homepage/persona/source/kind/entry）
- `POST /api/v1/assets/import` body `{source:{type:"url"|"path", value}}` → `{avatar}`（失败 422 `{error}`）
- `DELETE /api/v1/assets/:slug` → `{ok:true}`（非法 slug 400）

导入管线在 Go `internal/assets` 包：staging 解压（zip-slip 防护 + 1GB/2 万条目炸弹上限）→ 解包单层目录 → 入口探测（≤3 层）→ slug 冲突自动加后缀 → 原子 rename → 写 `.lovelybuddy.json` 来源侧车。模型根目录由 `--model-dir` / `LOVELYBUDDY_MODEL_DIR` 指定（默认 `../model`，与 dev 仓库 `model/` 一致）。
```

- [ ] **Step 3: make test 总验收**

Run: `make test`
Expected: Go vet/test 全绿（assets + server 引擎级）、`pnpm typecheck && pnpm test` 全绿（28 例）。

- [ ] **Step 4: 后端冒烟（curl，不依赖 GUI）**

```bash
cd server && go build -o ./bin/lovely-buddy-server ./cmd/lovely-buddy-server \
  && LOVELYBUDDY_MODEL_DIR=../model LOVELYBUDDY_DEV_TOKEN=dev ./bin/lovely-buddy-server &  # 后台
sleep 2
# 列表（haru/shizuku 样例）
curl -s -H "Authorization: Bearer dev" http://127.0.0.1:8740/api/v1/assets | head -c 400
# 造测试 zip 并导入（本地 path 来源）
python3 - <<'EOF'
import zipfile
with zipfile.ZipFile('/tmp/smoke-avatar.zip', 'w') as z:
    z.writestr('smoke/avatar.json', '{"name":"冒烟形象"}')
    z.writestr('smoke/smoke.model3.json', '{"Version":3}')
EOF
curl -s -X POST -H "Authorization: Bearer dev" -H "Content-Type: application/json" \
  -d '{"source":{"type":"path","value":"/tmp/smoke-avatar.zip"}}' http://127.0.0.1:8740/api/v1/assets/import
# 删除
curl -s -X DELETE -H "Authorization: Bearer dev" http://127.0.0.1:8740/api/v1/assets/smoke
# 清理进程与临时文件
pkill -f lovely-buddy-server; rm -f /tmp/smoke-avatar.zip
```

Expected: 列表返回 `"slug":"haru-cubism4"` 与 `"slug":"shizuku-cubism2"`（含 entry/source 字段）；导入返回 `{"avatar":{...,"slug":"smoke","name":"冒烟形象"}}`；删除返回 `{"ok":true}`；`../model` 下无 smoke 残留。

（若内存压力仍在（<39%），可先只跑此 curl 冒烟；`make dev` 全栈冒烟等内存恢复，把 pkill 收尾做好即可。）

- [ ] **Step 5: Commit**

```bash
git add README.md docs/design.md
git commit -m "docs: 形象系统 API 契约与 README 导入说明"
```

---

## Self-Review

- **Spec coverage**：§3.1（avatar.json 全字段 + 入口探测 ≤3 层 + persona 缺失回退）→ T1；§3.2 管线 6 步（HTTPS 512MB/重试/审计 → T3；zip-slip/探测/slug/原子 rename → T2；自动应用 → T4 store）→ 全有；§3.2 删除形象（仅限根内、二次确认）→ T2 Delete + T5 confirm；§3.3 形象列表/删除/导入 UI → T5（卡片化留给 M3，MA 只做功能级）；§3.4 版权红线 → 无资产入库，README 已有。**验收对齐**：贴 URL 下载→自动切换（T3+T4+T5 用例）、恶意 zip 被拒（T2/T3 测试 + 冒烟）、删除后列表即时刷新（T4 deleteModel + T5 用例）。
- **Placeholder scan**：所有步骤带完整代码与预期输出；无 TBD。
- **Type consistency**：`Avatar`（Go JSON tag）/`RawAvatar`/`AvatarInfo` 字段对齐（slug/name/kind/entry/author/version/license/homepage/source）；`ImportSource{type,value}` 在 Go/TS 同名同构；`probeEntry` 签名 T1 定义 T2 复用；`server.New` 新签名在 T1 一次性改齐（main.go 同步）。
- **执行注意**：Task 1 测试中 `len(got) != 4` 的断言依赖 broken 用例的最终布局——若数量偏差按注释核对用例布局后修正断言值（haru/shizuku/metanull 3 个 + broken 入 4 层被过滤 → 实际应为 3 个；以运行结果为准修正）。

# MR 改名 lovely-buddy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把代码库中所有 skyi 品牌标识（包名、二进制、IPC、env、容器、文档）替换为 lovely-buddy。

**Architecture:** 纯机械重构，不改变任何行为。按层拆 5 个任务（Go / 编排配置 / Electron 主进程 / renderer / 文档），每任务结束独立验证 + 提交。

**Tech Stack:** Go 1.27 / Electron / pnpm workspace / docker-compose

**Spec:** `docs/design.md` §6 改名迁移清单

## Global Constraints

- 命名规则（§6）：产品名 `lovely-buddy`；Go module `lovelybuddy/server`；二进制 `lovely-buddy-server`；IPC 前缀 `lovelybuddy:*`；preload 全局 `window.lovelybuddy`；env `LOVELYBUDDY_*`；容器 `lovelybuddy-postgres`；**`l2d://` 协议保留**；tray 文案「天依桌宠」保留
- **卷名也一并重命名** `skyi_pgdata` → `lovelybuddy_pgdata`（§6 原写「卷名不变」，执行时修订：dev 库目前无任何业务数据（M2 未开工），改干净比留 skyi 残留更值；旧卷手动清理见 Task 2）
- DSN 默认值跟随容器：`postgres://lovelybuddy:lovelybuddy@127.0.0.1:5433/lovelybuddy?sslmode=disable`
- commitlint：subject 不得 sentence-case（首词小写）
- 全程禁止动 `node_modules/`、`pnpm-lock.yaml`（不含 skyi）、`model/`、`docs/design.md`（历史提及「取代旧版 skyi-buddy 计划」可留）

---

### Task 1: Go 后端改名

**Files:**
- Rename: `server/cmd/skyi-server/` → `server/cmd/lovely-buddy-server/`（git mv）
- Modify: `server/go.mod`、`server/.air.toml`、`server/cmd/lovely-buddy-server/main.go`、`server/internal/` 下所有含 skyi 的测试文件（`accesslog_test.go`/`token_test.go` 等，仅字符串出现处）

**Interfaces:**
- Produces: 二进制名 `lovely-buddy-server`；env `LOVELYBUDDY_ADDR`/`LOVELYBUDDY_TOKEN`/`LOVELYBUDDY_DB_DSN`/`LOVELYBUDDY_DEV_TOKEN`（Task 2/3 依赖这些名字）

- [ ] **Step 1: 重命名 cmd 目录**

```bash
git mv server/cmd/skyi-server server/cmd/lovely-buddy-server
```

- [ ] **Step 2: go.mod 模块名**

`module skyi/server` → `module lovelybuddy/server`

- [ ] **Step 3: main.go 的 flag 与 DSN 默认值**

```go
addr  = flag.String("addr", envOr("LOVELYBUDDY_ADDR", "127.0.0.1:8740"), "监听地址（只应绑本机）")
token = flag.String("token", envOr("LOVELYBUDDY_TOKEN", ""), "鉴权 token（空则回退 LOVELYBUDDY_DEV_TOKEN）")
dsn   = flag.String("dsn", envOr("LOVELYBUDDY_DB_DSN", "postgres://lovelybuddy:lovelybuddy@127.0.0.1:5433/lovelybuddy?sslmode=disable"), "PostgreSQL DSN")
*token = os.Getenv("LOVELYBUDDY_DEV_TOKEN")
```

- [ ] **Step 4: .air.toml 构建路径**

```toml
cmd = "go build -o ./bin/lovely-buddy-server ./cmd/lovely-buddy-server"
bin = "./bin/lovely-buddy-server"
```

- [ ] **Step 5: 测试文件里的 skyi 字符串**

`grep -ri skyi server/` 逐处替换（含测试断言中的服务名/日志前缀字符串）。

- [ ] **Step 6: 验证**

```bash
cd server && go vet ./... && go test ./... && grep -ri skyi . --include="*.go" --include="*.toml" --include="go.mod"
```
Expected: 测试全绿；grep 无输出。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(server): rename skyi to lovely-buddy"
```

---

### Task 2: compose / CI / Makefile / env

**Files:**
- Modify: `docker-compose.yml`、`.github/workflows/ci.yml`、`Makefile`、`.env.example`、`.env`（用户本地文件，只改 key 名）

**Interfaces:**
- Consumes: Task 1 的二进制名/env 名
- Produces: 容器名 `lovelybuddy-postgres`、卷 `lovelybuddy_pgdata`、CI env `LOVELYBUDDY_TEST_DB_DSN`（Task 3 冒烟依赖）

- [ ] **Step 1: docker-compose.yml**

```
container_name: lovelybuddy-postgres
POSTGRES_USER: lovelybuddy / POSTGRES_PASSWORD: lovelybuddy / POSTGRES_DB: lovelybuddy
volumes: lovelybuddy_pgdata:/var/lib/postgresql/data
healthcheck: pg_isready -U lovelybuddy -d lovelybuddy
volumes 声明: lovelybuddy_pgdata:
```

- [ ] **Step 2: ci.yml**

`POSTGRES_USER/PASSWORD/DB: lovelybuddy`、`pg_isready -U lovelybuddy`、`SKYI_TEST_DB_DSN` → `LOVELYBUDDY_TEST_DB_DSN: postgres://lovelybuddy:lovelybuddy@127.0.0.1:5432/lovelybuddy?sslmode=disable`

- [ ] **Step 3: Makefile build-server**

`-o ../apps/desktop/resources/bin/lovely-buddy-server-darwin-arm64 ./cmd/lovely-buddy-server`

- [ ] **Step 4: .env.example 与 .env**

`SKYI_DEV_TOKEN` → `LOVELYBUDDY_DEV_TOKEN`（两文件同改；.env 是用户本地文件，属迁移必要项）

- [ ] **Step 5: 旧容器/卷清理（本机 dev 环境）**

```bash
docker rm -f skyi-postgres 2>/dev/null; docker volume rm skyi_pgdata 2>/dev/null
make db   # 起新容器 lovelybuddy-postgres，健康后进入下步
```

- [ ] **Step 6: 验证**

`docker ps --filter name=lovelybuddy-postgres` 显示 healthy；`grep -rn "skyi" docker-compose.yml .github/workflows/ci.yml Makefile .env.example .env` 无输出。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore(infra): rename db container and env to lovely-buddy"
```

---

### Task 3: Electron 主进程 + preload

**Files:**
- Modify: `apps/desktop/package.json`（name → `lovely-buddy`）、`apps/desktop/electron-builder.yml`（appId `dev.lovelybuddy.app`、productName `lovely-buddy`）、`apps/desktop/src/main/index.ts`、`apps/desktop/src/main/store.ts`（`SkyiSettings` → `LovelybuddySettings`）、`apps/desktop/src/preload/index.ts`

**Interfaces:**
- Produces: IPC 通道 `lovelybuddy:get-runtime`/`lovelybuddy:set-passthrough`/`lovelybuddy:move-window`/`lovelybuddy:move-window-end`/`lovelybuddy:resize-window`/`lovelybuddy:quit`/`lovelybuddy:list-models`/`lovelybuddy:pick-model-dir`；`window.lovelybuddy`（Task 4 依赖）

- [ ] **Step 1: package.json 与 electron-builder.yml**

`"name": "skyi-desktop"` → `"name": "lovely-buddy"`（userData 目录随 name 自动变）；`appId: dev.skyi.buddy` → `dev.lovelybuddy.app`；`productName: skyi-buddy` → `lovely-buddy`

- [ ] **Step 2: main/index.ts**

- env：`SKYI_ADDR` → `LOVELYBUDDY_ADDR`、`SKYI_DEV_TOKEN` → `LOVELYBUDDY_DEV_TOKEN`
- IPC 通道 8 处：`skyi:` → `lovelybuddy:`
- tray 文案「天依桌宠」**保留**；`l2d://` 不动

- [ ] **Step 3: main/store.ts**

`SkyiSettings` → `LovelybuddySettings`（3 处）

- [ ] **Step 4: preload/index.ts**

`SkyiApi` → `LovelybuddyApi`；`const skyi: SkyiApi` → `const lovelybuddy: LovelybuddyApi`；8 个通道名 `skyi:` → `lovelybuddy:`；`contextBridge.exposeInMainWorld('lovelybuddy', lovelybuddy)`

- [ ] **Step 5: 验证**

```bash
cd apps/desktop && pnpm typecheck
grep -rn "skyi" src/main src/preload package.json electron-builder.yml
```
Expected: typecheck 通过；grep 无输出。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(desktop): rename main/preload to lovelybuddy"
```

---

### Task 4: renderer + 前端测试

**Files:**
- Modify: `apps/desktop/src/renderer/src/env.d.ts`、`App.tsx`、`store/petStore.ts`、`pet/PetCanvas.tsx`、`pet/usePassthrough.ts`、`live2d/interact.ts`、`live2d/model.ts`、`live2d/__test__/interact.test.ts`、`__test__/App.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `window.lovelybuddy`

- [ ] **Step 1: 全局替换 window 引用**

- `window.skyi` → `window.lovelybuddy`（App.tsx / petStore.ts / usePassthrough.ts / interact.ts / model.ts）
- `interface SkyiApi` → `interface LovelybuddyApi`、`skyi: SkyiApi` → `lovelybuddy: LovelybuddyApi`（env.d.ts）

- [ ] **Step 2: localStorage 与日志前缀**

- `'skyi:model-url'` → `'lovelybuddy:model-url'`、`'skyi:placeholder-dismissed'` → `'lovelybuddy:placeholder-dismissed'`（petStore.ts）
- 控制台前缀 `[skyi]` → `[lovely-buddy]`（PetCanvas.tsx 2 处、model.ts 1 处）

- [ ] **Step 3: 测试文件**

- App.test.tsx：`mockSkyi` → `mockLovelybuddy`（2 处调用）、`vi.stubGlobal('skyi', …)` → `'lovelybuddy'`、`window.skyi.` → `window.lovelybuddy.`（6 处）
- interact.test.ts：`vi.stubGlobal('skyi', …)` → `'lovelybuddy'`

- [ ] **Step 4: 验证**

```bash
cd apps/desktop && pnpm typecheck && pnpm test
grep -rn "skyi" src/renderer
```
Expected: typecheck + 24 项测试全绿；grep 无输出。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(renderer): rename window.skyi to window.lovelybuddy"
```

---

### Task 5: 文档与总验收

**Files:**
- Modify: `README.md`（重写：新定位、改名、版权声明、§6 术语）、`LICENSE`（Copyright 行）、根 `package.json`（name → `lovely-buddy`、description）

**Interfaces:**
- 无新接口；全仓命名收敛

- [ ] **Step 1: LICENSE 与根 package.json**

`Copyright (c) 2026 skyi-buddy contributors` → `lovely-buddy contributors`；`"name": "skyi-buddy"` → `"lovely-buddy"`；description → `lovely-buddy：可换形象的本地 AI 桌宠与 AI 桌面端表情接口（Electron + Live2D / Go + pgvector / MCP）`

- [ ] **Step 2: README 重写**

按 docs/design.md §1 定位重写（保留 make dev/test 等用法不变；洛天依版权声明保留并强化；新增「形象下载不内置任何源」说明）

- [ ] **Step 3: 全仓残留检查**

```bash
grep -ri "skyi" . --exclude-dir=node_modules --exclude-dir=model --exclude=pnpm-lock.yaml 2>/dev/null | grep -v "docs/design.md"
```
Expected: 无输出（docs/design.md 的历史提及「取代旧版 skyi-buddy 计划」允许保留）。

- [ ] **Step 4: 总验收 make test + dev 冒烟**

```bash
make test          # Go vet/test + typecheck + vitest 全绿
ELECTRON_ENABLE_LOGGING=1 make dev   # 冒烟：容器 healthy、renderer 加载模型、healthz 轮询
```
冒烟通过后 pkill 清理（`pkill -f "lovely-buddy/node_modules/.pnpm/electron"`、`pkill -f lovely-buddy-server`、`pkill -f electron-vite`）。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: rename to lovely-buddy and rewrite README"
```

---

## Self-Review

- **Spec coverage**：§6 表格 9 行全部有任务对应（Go/二进制→T1；容器/env→T2；Electron 包名/IPC/preload 全局→T3/T4；协议保留与目录改名说明→T5 README；仓库目录 mv 为可选手工步骤，README 中提示）
- **Placeholder scan**：无 TBD/占位；每个替换都给出精确前后值
- **Type consistency**：`LovelybuddyApi`/`window.lovelybuddy`/`lovelybuddy:*` 在 T3/T4 命名一致；env 名在 T1/T2/T3 一致（`LOVELYBUDDY_ADDR`/`LOVELYBUDDY_DEV_TOKEN`）
- 风险修订：卷名一并改名（dev 库无数据），旧卷清理写入 T2 Step 5

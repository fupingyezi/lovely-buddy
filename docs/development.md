# 开发指南

## 环境要求

- Node 22 + pnpm
- Go 1.27
- Docker（本地 PostgreSQL + pgvector，仅绑 127.0.0.1）
- 目前仅在 macOS（darwin-arm64）上开发与打包

## 常用命令

| 命令 | 作用 |
|---|---|
| `make setup` | 首次克隆后：安装依赖、生成托盘图标、下载 Cubism core 与示例模型、初始化 .env |
| `make dev` | 一键开发：db + Go 后端（air 热重载）+ Electron（electron-vite 热更） |
| `make test` | Go vet/test + 前端 typecheck + vitest |
| `make db` | 启动 PostgreSQL（pgvector） |
| `make assets` | 下载 Cubism core 与官方免费示例模型（shizuku/haru） |
| `make build-server` | 编译 Go 二进制 → `apps/desktop/resources/bin/`（darwin-arm64） |
| `make build` | 打包 macOS 应用（未签名，仅本地使用） |
| `make clean` | 清理构建产物 |

单测：

```bash
cd apps/desktop && pnpm vitest run src/renderer/src/pet/__test__/usePetMenu.test.ts  # 前端单文件
cd server && go test ./...                                                          # Go 全量
```

## 架构速览

```
apps/desktop/                Electron
├── src/main/                主进程：透明置顶小窗、托盘、点击穿透、窗口扩展/缩回/缩放、子进程管理
├── src/preload/             contextBridge 暴露 window.lovelybuddy（IPC 前缀 lovelybuddy:*）
└── src/renderer/            React 18 + zustand + pixi.js v7 + pixi-live2d-display
    ├── live2d/              模型加载；interact（screenX/screenY 拖拽/tap，屏幕坐标防漂移）；
    │                        windowAnchor（窗口 resize 时模型位稳平移）
    ├── pet/                 usePassthrough（穿透状态机）、usePetMenu/menuLayout/PetMenu（形象菜单）、
    │                        chat/（输入条、气泡）、settings/（设置面板·对话记录）
    ├── styles/tokens.css    设计 token（design-v1 规范单一来源）
    ├── store/petStore.ts    全局状态（模型列表/当前形象/后端状态）
    └── lib/assetsApi.ts     HTTP API 客户端（token 由主进程通过 IPC 提供）

server/                      Go + gin
├── cmd/lovely-buddy-server  入口（env：LOVELYBUDDY_ADDR/TOKEN/DB_DSN/DEV_TOKEN）
└── internal/
    ├── assets/              形象探测/导入/删除（model/ 目录 + avatar.json + .lovelybuddy.json 侧车）
    ├── middleware/          token 鉴权 / CORS / 访问日志
    └── db/                  PostgreSQL + pgvector

docker-compose.yml           lovelybuddy-postgres（pgvector），仅绑 127.0.0.1
```

`/healthz` 公开（健康探测）；`/api/v1/*` 全部要求 token（dev 模式用 `LOVELYBUDDY_DEV_TOKEN`，打包模式启动时随机生成）。

## 关键机制与坑

1. **点击穿透状态机**（`pet/usePassthrough.ts` + 主进程 `set-passthrough`）：窗口默认穿透，主进程用 `setIgnoreMouseEvents(on, {forward: true})`——穿透时 mousemove 仍会到达渲染进程（否则窗口会永久卡死），但**点击会穿到桌面**。悬停模型或带 `data-interactive` 的面板时关穿透，移出恢复；菜单打开时整窗不穿透（菜单外的点击用于关菜单）。
   ⚠️ effect 的 cleanup 会无条件把穿透置回 true；新 effect 的立即同步**必须无条件发 IPC**（走本地去重会被跳过 → 窗口卡死在穿透态：移动有反应、点击全穿透、菜单关不掉）。回归用例见 `pet/__test__/usePassthrough.test.ts`。
2. **窗口扩展与模型位稳**：`expand-window` 向左上扩展（右下角锚定，按屏幕工作区夹紧）。渲染进程在 window resize 时按窗口尺寸增量平移模型（`live2d/windowAnchor.ts` 的 `shiftToKeepScreenPosition`）保持屏幕位置不动——改窗口尺寸逻辑时这两处必须同步改，否则角色会「瞬移」。
3. **重启 make dev 前先查内存**：系统内存吃紧会 SIGTERM 整个 make dev（`memory_pressure -Q` 看 free percentage，低于 ~30% 慎启）。
4. **临时诊断用完即删**：曾用 Go 端点 `/api/v1/debug-log` + 渲染进程 `lib/dbg.ts` 排查穿透问题，定位后必须整体移除，不留残余。

## 测试约定

- 前端测试放功能目录下 `__test__/*.test.{ts,tsx}`（vitest + jsdom + @testing-library/react）；Go 测试与源码同目录（`*_test.go`，Go 工具链忽略 `_` 开头的目录，不能用 `__test__/`）。
- 提交前 `make test` 全绿。

## 提交与 CI

- Conventional Commits，subject 小写开头（commitlint + husky 本地强制）。
- 当前为快速开发阶段，改动直接提交 main，不走分支/PR。
- CI（GitHub Actions）：Go vet/test（pgvector 服务）、前端 typecheck/vitest/build、commitlint。

## 命名

- 产品显示名 **AI桌宠**（窗口标题、托盘、状态文案、productName）；用户可见文案不出现具体角色名，测试夹具用中性素材名（haru/shizuku）。
- 内部标识不变：repo/包名 `lovely-buddy`、Go module `lovelybuddy/server`、IPC 前缀 `lovelybuddy:*`、preload 全局 `window.lovelybuddy`、env `LOVELYBUDDY_*`、容器 `lovelybuddy-postgres`、协议 `l2d://`。

## 聊天联调（M2）

1. `.env` 填 `DEEPSEEK_API_KEY=...`（或 `LOVELYBUDDY_CHAT_PROVIDER=dashscope` + `DASHSCOPE_API_KEY`），`make dev` 重启。
2. 右键桌宠 → 「聊天」→ 输入消息，回车发送；回复以打字机气泡出现在角色上方。
3. 冒烟 SSE（不经 UI）：

   ```bash
   curl -sN -H "Authorization: Bearer dev" -H "Content-Type: application/json" \
     -d '{"message":"打个招呼"}' http://127.0.0.1:8740/api/v1/chat
   curl -s -H "Authorization: Bearer dev" 'http://127.0.0.1:8740/api/v1/history?limit=5'
   ```

4. 未配 key 时发送会收到「未配置 API key」错误提示，属预期。

# CLAUDE.md

## 项目

**AI桌宠**（repo: lovely-buddy）：可换形象的本地 AI 桌宠——Electron + Live2D 桌面宠物，Go 后端（形象库 API 已实现，LLM 对话与 MCP 宿主接入规划中）。

- 产品规格：`docs/design.md`（v2，含里程碑）；开发指南：`docs/development.md`；模型放置：`docs/model-setup.md`；历史计划：`docs/superpowers/plans/`
- 产品显示名 **AI桌宠**——用户可见文案禁用具体角色名（天依/洛天依），测试夹具用中性素材名（haru/shizuku）。内部标识不变：`lovely-buddy`、`lovelybuddy:*` IPC、`window.lovelybuddy`、`LOVELYBUDDY_*` env、`l2d://` 协议。

## 常用命令

- `make dev` —— 一键开发（db + Go air + Electron）。**重启前先 `memory_pressure -Q`**：内存吃紧会 SIGTERM 整个 make dev
- `make test` —— 全量（Go vet/test + typecheck + vitest）
- 前端单测：`cd apps/desktop && pnpm vitest run <file>`
- `make db` / `make assets` / `make setup` / `make build-server` / `make build`

## 架构速览

- `apps/desktop`（Electron）：`src/main` 主进程入口（生命周期装配/托盘/CSP/设置持久化）；`src/bridge` 渲染↔主通信（`lovelybuddy:*` IPC、`l2d://` 协议）；`src/window` 窗口服务（穿透 `setIgnoreMouseEvents(on, {forward:true})`/expand-collapse-resize 窗口/独立设置窗口）；`src/preload` 暴露 `window.lovelybuddy`；`src/renderer` React 18 + zustand + PIXI v7 + pixi-live2d-display + Tailwind v4
  - `live2d/`：interact（screenX/screenY 拖拽/tap）、windowAnchor（窗口 resize 时模型位稳平移）、windowGeometry（窗口尺寸+模型基准尺寸单一事实来源）、waitForResize（等 resize 落地，超时兜底）
  - `hooks/`：usePassthrough（穿透状态机）、usePetMenu、useChatPanel、useTypewriter（测试随功能目录 `__test__/`）
  - `pet/`：menuLayout/PetMenu（形象菜单：高度自适应 menuHeight(n) 单一事实来源、缩略行切换、渐变聊天键离线禁用、入口收敛到设置）、chat/（输入条三态+错误重试、气泡锚定头部左上角按绘制部件实际边界+弹出动画，发完自动收起、气泡只弹本会话流式回复）、settings/（独立无边框设置窗口：对话记录页搜索/导出/清空与形象管理页导入/删除，导入删除经 notify-models-changed 广播跨窗同步；nav 其余项 M3+ 禁用）
  - `styles/tokens.css` 设计 token（design-v1 单一来源，Tailwind v4 `@theme` 生成工具类）；`styles/index.css` 仅透明窗壳/气泡相位变体/app-region；`store/petStore.ts` 全局状态；`lib/assetsApi.ts` HTTP 客户端
- `server`（Go + gin）：`/healthz` 公开，`/api/v1/*` token 中间件；`internal/assets` 形象探测/导入/删除；`internal/db` pgvector
- `docker-compose.yml`：lovelybuddy-postgres（pgvector），仅绑 127.0.0.1

## 约定与坑

- **Commit**：Conventional Commits，subject 小写开头（commitlint + husky 强制）；当前快速开发阶段改动直接提交 main，不走分支/PR
- **测试**：前端测试放功能目录下 `__test__/`；Go 测试与源码同目录（Go 忽略 `_` 开头目录，不能用 `__test__/`）
- **样式**：Tailwind v4 工具类全量——JSX 只写工具类，CSS 只留 @theme token/相位变体/app-region；token 引用 `bg-primary`、`gap-(--sp-1)`（非命名空间变量括号简写），裸值用默认刻度/任意值；互斥状态必须整支分支（不靠工具类输出顺序）；语义类只留测试锚点（`pet-canvas`/`pet-menu`/`settings-panel`/`placeholder`/`speech-bubble(+body)`/`settings-titlebar`/`settings-close`/`active`/`assistant`）。`shadow-mint` 系列 token 保留：仍被 App.tsx 占位卡引用（v0.1 改版未覆盖占位卡），占位卡改版时一并清理
- **穿透状态机**：穿透时 mousemove 仍到达渲染进程、**点击穿到桌面**。usePassthrough 的 effect cleanup 无条件置穿透 true，新 effect 的立即同步必须**无条件发 IPC**（走本地去重会被跳过 → 窗口卡死穿透：移动有反应、点击全穿透）。延迟收起（useChatPanel 气泡保持期结束）不强制穿透——菜单打开期间会吞掉菜单点击。回归用例 `hooks/__test__/usePassthrough.test.ts`
- **窗口扩展**：expand-window 向左上扩（右下锚定），渲染进程在 resize 时按尺寸增量平移模型（windowAnchor）保持屏幕位置——两处必须同步改，否则角色瞬移。菜单展开走 expand-menu 由主进程按真实 bounds 算扩展量（渲染进程 innerWidth 落后 resize 事件会算错宽度）；气泡/菜单定位统一走 live2d/windowGeometry 几何 store 渲染期推导，组件不得自行监听 resize 定位（监听顺序竞态）。菜单高度自适应：menuLayout.menuHeight(n) 是渲染高度与 expandMenu 扩展量的单一事实来源，两处必须引用同一函数（图 07）
- **设置窗口**：独立无边框 BrowserWindow（960×600，`?settings=1` 复用同一 renderer，不加载 PIXI）；拖拽靠标题条 `-webkit-app-region: drag`；清空对话走 `notify-chat-cleared` → 主进程广播 `chat-cleared` → 桌宠窗口刷新
- **临时诊断用完即删**：给渲染进程加日志曾用 Go 端点 `/api/v1/debug-log` + `lib/dbg.ts`，定位后必须整体移除

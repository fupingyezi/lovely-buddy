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

- `apps/desktop`（Electron）：`src/main` 主进程入口（生命周期装配/托盘/CSP/`settings-store` 设置持久化）；`src/bridge` 渲染↔主通信（`channels.ts` 频道名契约、`lovelybuddy:*` IPC、`l2d://` 协议）；`src/window` 窗口服务（穿透 `setIgnoreMouseEvents(on, {forward:true})`/expand-collapse-resize 窗口/独立设置窗口）；`src/preload` 暴露 `window.lovelybuddy`（频道名引用 `channels.ts`）；`src/renderer` React 18 + zustand + PIXI v7 + pixi-live2d-display + Tailwind v4（index.html 与源码同级，不再嵌套 renderer/src；renderer 内 import 一律 `@/` 别名指向 renderer 根）
  - `live2d/` 模型引擎与窗口几何（不依赖 pet/settings/store），按职责分四组：`engine/`（model/loader/stage/modelBus/capabilities，model.ts 为跨组枢纽）、`motion/`（motionMap/motionScheduler/actions）、`window/`（windowGeometry 窗口尺寸+模型基准尺寸单一事实来源、windowAnchor 窗口 resize 模型位稳平移、waitForResize 等 resize 落地超时兜底）、`interaction/`（interact screenX/screenY 拖拽/tap、hitbox）
  - `pet/` 桌宠悬浮层（主窗口 UI 域，hook 随功能就近）：menuLayout/PetMenu（形象菜单：高度自适应 menuHeight(n) 单一事实来源、缩略行切换、渐变聊天键离线禁用、入口收敛到设置）、chat/（输入条三态+错误重试、气泡锚定头部左上角按绘制部件实际边界+弹出动画，发完自动收起、气泡只弹本会话流式回复；useChatPanel/useTypewriter）、PetCanvas/ImportPanel/PlaceholderCard、usePetMenu/usePassthrough（穿透状态机）
  - `settings/` 独立设置窗口应用（`?settings=1` 复用 renderer，不依赖 pet/live2d）：对话记录页搜索/导出/清空、形象管理页导入/删除经 notify-models-changed 广播跨窗同步、模型与连接页连接增删改/测试连接/保存启用——经 /api/v1/config 注入对话 API、热切换免重启，key 只存本机 JSON 0600；nav 其余项（外观与动作/关于）M3+ 禁用
  - 组合根：`main.tsx`（`?settings=1` 分流 SettingsApp/App）、`App.tsx`、`useBackendHealth`（健康轮询）、`useChatSync`（历史同步与跨窗刷新）；`env.d.ts` 全局类型、`css.d.ts` CSS 声明；`styles/tokens.css` 设计 token（design-v1 单一来源，Tailwind v4 `@theme` 生成工具类）；`styles/index.css` 仅透明窗壳/气泡相位变体/app-region；`store/petStore.ts` 全局状态；`lib/assetsApi.ts` HTTP 客户端
- `server`（Go + gin）：`/healthz` 公开，`/api/v1/*` token 中间件；`internal/assets` 形象探测/导入/删除；`internal/db` pgvector；`internal/lovely-agent` harness 分层（model/agent 已落地，memory/extension 规划中——docs/superpowers/specs/2026-10-25-harness-layering-design.md）
- `docker-compose.yml`：lovelybuddy-postgres（pgvector），仅绑 127.0.0.1

## 约定与坑

- **Commit**：Conventional Commits，subject 小写开头（commitlint + husky 强制）；当前快速开发阶段改动直接提交 main，不走分支/PR
- **测试**：前端测试放功能目录下 `__test__/`；Go 测试与源码同目录（Go 忽略 `_` 开头目录，不能用 `__test__/`）
- **Import 别名**：renderer 内相对 import 一律 `@/`（指向 `src/renderer`，vite/tsconfig/vitest 三处同配）；`main/preload/window/bridge` 保持相对路径，不得使用 `@/`
- **样式**：Tailwind v4 工具类全量——JSX 只写工具类，CSS 只留 @theme token/相位变体/app-region；token 引用 `bg-primary`、`gap-(--sp-1)`（非命名空间变量括号简写），裸值用默认刻度/任意值；互斥状态必须整支分支（不靠工具类输出顺序）；语义类只留测试锚点（`pet-canvas`/`pet-menu`/`settings-panel`/`placeholder`/`speech-bubble(+body)`/`settings-titlebar`/`settings-close`/`active`/`assistant`）。`shadow-mint` 系列 token 保留：仍被 pet/PlaceholderCard.tsx 占位卡引用（v0.1 改版未覆盖占位卡），占位卡改版时一并清理
- **穿透状态机**：穿透时 mousemove 仍到达渲染进程、**点击穿到桌面**。usePassthrough 的 effect cleanup 无条件置穿透 true，新 effect 的立即同步必须**无条件发 IPC**（走本地去重会被跳过 → 窗口卡死穿透：移动有反应、点击全穿透）。延迟收起（useChatPanel 气泡保持期结束）不强制穿透——菜单打开期间会吞掉菜单点击。回归用例 `pet/__test__/usePassthrough.test.ts`
- **窗口扩展**：expand-window 向左上扩（右下锚定），渲染进程在 resize 时按尺寸增量平移模型（windowAnchor）保持屏幕位置——两处必须同步改，否则角色瞬移。菜单展开走 expand-menu 由主进程按真实 bounds 算扩展量（渲染进程 innerWidth 落后 resize 事件会算错宽度）；气泡/菜单定位统一走 live2d/window/windowGeometry 几何 store 渲染期推导，组件不得自行监听 resize 定位（监听顺序竞态）。菜单高度自适应：menuLayout.menuHeight(n) 是渲染高度与 expandMenu 扩展量的单一事实来源，两处必须引用同一函数（图 07）
- **设置窗口**：独立无边框 BrowserWindow（960×600，`?settings=1` 复用同一 renderer，不加载 PIXI）；拖拽靠标题条 `-webkit-app-region: drag`；清空对话走 `notify-chat-cleared` → 主进程广播 `chat-cleared` → 桌宠窗口刷新
- **临时诊断用完即删**：给渲染进程加日志曾用 Go 端点 `/api/v1/debug-log` + `lib/dbg.ts`，定位后必须整体移除

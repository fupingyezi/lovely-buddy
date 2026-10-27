# 渲染进程目录重组与模块边界重划设计

> 状态：已确认设计（2026-10-27，brainstorming 三问 + 两节逐项确认）｜实施计划待定：纯结构重构，行为零变化
> 与 CLAUDE.md 的关系：实施后 CLAUDE.md「架构速览」与「约定与坑」中的路径描述同步更新。

## 1. 背景与目标

现状：渲染进程源码堆在 `src/renderer/src/`（electron-vite 默认约定——renderer 根固定为 `src/renderer`、index.html 必须在根下，源码落一层 `src/`），嵌套别扭；模块边界存在四类问题：

1. **`pet/settings/` 放错域**：独立设置窗口应用（独立入口 SettingsApp，`?settings=1` 复用 renderer），只被 main.tsx 引用，却塞在桌宠悬浮层 pet/ 下。
2. **`App.tsx` 兼职过多**：健康轮询、跨窗事件订阅、占位卡 JSX 全内联在组合根。
3. **`live2d/` 平铺混放**：引擎（model/loader/stage/motionMap/motionScheduler/actions/capabilities）、窗口几何（windowGeometry/windowAnchor/waitForResize）、交互（interact/hitbox）三类职责同层。
4. **同名歧义**：主进程 `src/main/store.ts`（SettingsStore 设置持久化）与渲染进程 `store/`（zustand）同名不同义；preload 与 bridge/ipc.ts 双份硬编码频道名字面量。

目标：扁平化 `src/renderer/src` → `src/renderer`，按功能域与依赖方向重划模块边界，引入 `@/` 别名消除深相对路径，IPC 频道名收归单一契约。**纯结构重构：不改任何运行时行为、不引新工具链。**

## 2. 目标目录树

```
apps/desktop/src/
├── main/                        # 主进程
│   ├── index.ts / csp.ts / tray.ts
│   └── settings-store.ts        # ← 原 store.ts 改名（SettingsStore，JSON 持久化），
│                                #   消除与渲染进程 store/ 的同名歧义
├── preload/index.ts             # window.lovelybuddy 注入（LovelybuddyApi 类型契约）
├── bridge/                      # IPC 契约实现（主进程侧）
│   ├── channels.ts              # ← 新增：lovelybuddy:* 频道名常量，preload 与 ipc.ts 共享，
│   │                            #   消除两处硬编码字面量
│   ├── ipc.ts
│   └── protocol.ts
├── window/                      # 主进程窗口服务（不变）
│   ├── manager.ts / settings.ts / bounds.ts
└── renderer/                    # ← 扁平化：index.html 与源码同级，不再有 renderer/src
    ├── index.html               # script 引用 /src/main.tsx → ./main.tsx
    ├── public/live2d/           # Cubism core 静态资源（不动）
    ├── main.tsx                 # 入口：?settings=1 分流 SettingsApp / App
    ├── App.tsx                  # 只做组合：画布+菜单+气泡+占位卡的编排
    ├── useBackendHealth.ts      # ← 从 App 抽出：健康轮询 + 状态写入 petStore
    ├── useChatSync.ts           # ← 从 App 抽出：启动拉历史/断线恢复刷新/chat-cleared 订阅
    ├── env.d.ts / css.d.ts      # ← 原 declare/ 上提（css.d.ts 保持脚本文件形态）
    ├── styles/                  # tokens.css / index.css（不动）
    ├── lib/                     # assetsApi / chatApi / configApi（不动）
    ├── store/                   # petStore / chatStore / connectionStore（不动）
    ├── live2d/                  # ← 按职责分四组，model.ts 仍是跨组枢纽
    │   ├── engine/              #   model / loader / stage / modelBus / capabilities
    │   ├── motion/              #   motionMap / motionScheduler / actions
    │   ├── window/              #   windowGeometry / windowAnchor / waitForResize
    │   └── interaction/         #   interact / hitbox
    ├── pet/                     # 桌宠悬浮层（主窗口 UI 域）
    │   ├── PetCanvas / PetMenu / ImportPanel / menuLayout
    │   ├── PlaceholderCard.tsx  # ← 从 App 内联 JSX 抽出
    │   ├── usePetMenu.ts / usePassthrough.ts   # ← 原 hooks/ 迁入
    │   └── chat/                #   ChatPanel / SpeechBubble / bubbleLayout / bubbleTiming
    │                            #   + useChatPanel.ts / useTypewriter.ts（← 原 hooks/ 迁入）
    └── settings/                # ← 移出 pet/：独立设置窗口应用（SettingsApp 为独立入口）
        └── SettingsApp / SettingsPanel / ConnectionPage / ModelPage / ChatHistoryPage
            / connectionFormat / historyExport
```

测试随功能目录整搬（`__test__/` 约定不变）：live2d 四组各自带 `__test__/`，hooks 测试随 hook 迁入 pet/ 与 pet/chat/，App.test.tsx 留 renderer 根下 `__test__/`。

## 3. 依赖方向（硬规则）

| 模块 | 职责 | 允许依赖 |
|---|---|---|
| `live2d/` | 模型引擎 + 窗口几何 + 交互（PIXI 世界） | 自身、`@/lib`；**不依赖 pet/、settings/、store/** |
| `pet/` | 桌宠悬浮层 UI + 交互逻辑（React 世界） | `@/live2d`、`@/store`、`@/lib`、自身 |
| `settings/` | 设置窗口应用 | `@/store`、`@/lib`、自身；**不依赖 pet/、live2d/** |
| `store/`、`lib/` | 全局状态 / API 客户端 | 相互 + 类型；不依赖 UI 与 live2d |
| renderer 根 | 组合根（main.tsx/App.tsx/两个 sync hook） | 一切 |

该方向是现状依赖图的合法化（已验证：live2d 当前不 import pet/store，settings 只被 main.tsx 引用），移动不会制造反向依赖。

## 4. 落地细节

### 4.1 @/ 别名（三处配置）

- `electron.vite.config.ts`：renderer 增加 `resolve.alias: { '@': resolve('src/renderer') }`；main/preload **不加**别名（@/ 指向 renderer，主进程用它会制造错误依赖）。
- `tsconfig.json`：`paths: { "@/*": ["./src/renderer/*"] }`（TS 5.x 免 baseUrl）。
- `vitest.config.ts`：`resolve.alias` 同 vite（测试文件 import 也全改 @/）。

### 4.2 import 重写方式

全部 renderer 文件（含 `__test__/`）的 renderer 内部 import 改 `@/`；`main/preload/window/bridge` 保持相对路径。文件先 `git mv` 到位，再跑一次性 node 脚本：对每个 renderer 文件解析相对 import → resolve 绝对路径 → 落在 renderer 根内则重写为 `@/` 形式。脚本用完即删。

### 4.3 channels.ts 契约去重

`bridge/channels.ts` 导出 `CHANNELS` 常量对象，`bridge/ipc.ts`（主进程注册）与 `preload/index.ts`（渲染侧调用）共同 import——IPC 契约单一事实来源，频道名改一处生效。

### 4.4 迁移顺序（保持中间态可编译）

1. 三处 @/ 配置 + `index.html` script 改 `./main.tsx`（此步后旧结构仍可运行）
2. `git mv` 全量移动（保留 git 历史）
3. 脚本重写 import + 新建 channels.ts 改两处引用
4. App.tsx 拆出 `useBackendHealth` / `useChatSync` / `PlaceholderCard`
5. `main/store.ts` → `main/settings-store.ts`，改两处引用（main/index.ts、window/manager.ts）
6. 验证：`pnpm typecheck` + `pnpm vitest run` + `pnpm format:check` + `pnpm build`
7. 重写 CLAUDE.md 架构速览（live2d 分组、hooks 撤销、settings 迁移、@/ 约定、穿透状态机测试路径）
8. 单一 commit 提交 main（纯结构重构、无行为变化、测试全绿）

## 5. 明确不做

- 不改任何运行时行为（状态机、几何计算、窗口逻辑、样式全部原样移动）
- 不动 Go 后端、Makefile、docker 配置
- 不引入 ESLint/import-order 等新工具链
- ConnectionPage.tsx（437 行）的内部拆分不在本次范围（组件内部逻辑问题，与目录结构无关，另立任务）

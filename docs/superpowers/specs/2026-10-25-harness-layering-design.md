# lovely-agent harness 分层架构设计

> 状态：已确认设计（2026-10-25，brainstorming 逐项确认）｜实施计划待定：本设计不动代码，是 server 端 LLM 子系统的 M3+ 蓝图
> 与 docs/design.md 的关系：design.md 是产品基准；本文档是「模型对接 + 宿主接入」能力的架构细化，实施后 design.md §4 同步更新。

## 1. 背景与目标

现状：server 端 LLM 子系统平铺在 `internal/llm`（provider 抽象 + openai_compat + forward 八件套），编排在 service 层单轮 ChatService。后续能力（记忆 M5、主动搭话 M6、skills/MCP 扩展、宿主接入 MB）继续堆在平铺结构上，编排逻辑将与模型调用、扩展执行纠缠。

目标：把 LLM 子系统按 harness 分层——**模型层 / agent loop 层 / 记忆管理 / 扩展层**——依赖单向、接口先行，每层可独立理解、测试、替换。

**单脑原则（贯穿全文）**：桌宠的「脑」只有一个——接入端大脑（forward 对端，即朋友 app）或外部模型厂商。lovely-agent 是编排不是脑：不持久化推理状态；db 里的对话历史是记录（transcript），不是推理状态。红线延续 docs/forward-provider.md §1.2「转发层一旦存东西就变成第二个脑」。

## 2. 分层总览

```
internal/lovely-agent/          # harness 根（纯目录壳，无 Go 文件）
├── model/                      # 模型层：换脑插槽。无状态、无记忆
│   ├── provider.go             # ChatProvider / Message / StreamEvent 接口
│   ├── registry.go             # Registry 热切换（Swap/Current）
│   ├── openai_compat.go        # OpenAI 兼容实现（行为不动）
│   ├── forward/                # forward 八件套整体迁入，一行不改
│   └── embedding.go            # M5：EmbeddingProvider.EmbedBatch
├── agent/                      # agent loop 层：编排，不是脑
│   ├── loop.go                 # Loop 状态机：单轮直通 ↔ 工具循环
│   ├── context.go              # 上下文构建：persona/系统提示/历史/记忆/技能 → messages
│   ├── tool.go                 # Tool 接口 + ToolRegistry（调用 → 执行 → 回喂）
│   └── event.go                # LoopEvent：delta/tool_status/done/error
├── memory/                     # 记忆管理（独立文件夹，M5 管线归此）
│   ├── memory.go               # Memory 接口：Retrieve / Remember
│   ├── context.go              # 记忆构建：检索 → prompt 记忆段组装
│   ├── extract.go              # 抽取编排：对话完成 → 抽取 → 去重 → 回写
│   └── store.go                # Store 接口；pgvector 实现经 DAO 注入
└── extension/                  # 扩展层：桌宠向外长出的能力
    ├── skill/                  # Claude Code 式声明包（发现/解析/注入）
    └── mcpclient/              # MCP 调用方（go-sdk）→ 适配为 agent.Tool

internal/mcp/                   # 服务包装：MCP server 给外部宿主（薄壳，无状态）
internal/service/               # 桌宠侧编排：chat 入口、MotionFilter、transcript 落库、wiring
```

### 2.1 依赖方向（硬规则）

- agent → model、agent → memory、agent → extension 契约；agent 不 import 任何具体扩展实现。
- extension 只 import agent 的接口类型（`Tool`），反向不成立。
- memory → model（`EmbeddingProvider`）。
- harness 内任何层不 import `internal/service`、`internal/db`、`internal/mcp`。
- 服务包装 `internal/mcp` 是 service 的薄壳，与 harness 无关。
- 组装职责唯一归 service：service 构造具体实现，以接口注入 harness（Go 消费方接口模式）。

### 2.2 各层职责一句话

- **model**：拿消息流，还流式文本。无状态、无记忆。
- **agent**：编排一次对话——构建上下文、驱动循环、执行工具。瞬态只在本轮循环内。
- **memory**：记忆管理——检索注入、抽取回写、存储抽象。
- **extension**：桌宠向外扩展的能力——skills 声明包、外部 MCP 工具。
- **服务包装（internal/mcp）**：桌宠作为 MCP server 被外部宿主（Codex/DeepSeek Harness/Claude Desktop）调用。
- **service**：桌宠侧编排与适配——chat 入口、MotionFilter、transcript 落库、全部 wiring。

### 2.3 命名与包路径

目录名 `lovely-agent`（Go 导入路径允许连字符目录名），导入路径形如 `lovelybuddy/server/internal/lovely-agent/model`。harness 根是纯目录壳，不含 Go 文件——包名取叶名（model/agent/memory/extension），不存在连字符包名问题。

## 3. 模型层（lovely-agent/model）

- `provider.go`：`ChatProvider.StreamChat(ctx, msgs) <-chan StreamEvent`、`Message`、`StreamEvent`——现 `internal/llm` 接口原样迁入，签名与语义不变。
- `registry.go`：`Registry`（Swap/Current）原样迁入。「切换只影响下一次对话」的既有语义不变。
- `openai_compat.go`：行为不动，仅迁移。
- `forward/` 子包：forward 八件套整体迁入，仅改 package 声明与跨包引用，逻辑与测试不变（该代码已完成 SDD 全流程评审，2026-10-25 落地，手工验收中）。
- `embedding.go`（M5）：`EmbeddingProvider.EmbedBatch(ctx, texts)`——embedding 是模型能力，归本层。
- **单脑红线**：forward 是「接入端大脑」的唯一入口；本层禁止持久化任何推理状态。
- 错误契约沿用 docs/forward-provider.md §4.8（ctx 取消静默关通道、密钥不进错误文案），并提升为**全 harness 通用契约**（见 §9）。

## 4. agent loop 层（lovely-agent/agent）

### 4.1 context.go——上下文构建

`ContextConfig{SystemPrompt, PersonaLoader, MemoryRetriever, SkillProvider, HistorySource}` 由 service 组装注入——动作协议等桌宠专属文案不进 harness 源码。构建顺序固定（延续现 prompt.go 的缓存友好顺序）：

```
稳定前缀（人设 + 动作协议）→ 历史 → 技能指令 → 检索记忆 → 最新输入
```

- persona：`avatar.json.persona` 经 `PersonaLoader` 注入（现 `assets.PersonaText` 适配为接口）。
- 历史：`HistorySource` 注入（现 service.ChatStore 适配），截断（现 historyLimit=20）由 service 注入参数控制。
- 记忆、技能：调用注入的接口，harness 不感知具体实现。接口类型归属各层：`Memory` 定义在 memory 包、`SkillProvider` 定义在 extension 包、`Tool` 定义在 agent 包；agent 只 import 接口类型，不 import 具体实现（wiring 由 service 完成）。

### 4.2 tool.go——工具契约

```go
type Tool interface {
    Name() string
    Description() string // 面向模型：何时用、怎么用、入参格式
    Execute(ctx context.Context, args string) (string, error)
}
```

- `ToolRegistry`：注册/查找；工具由 service wiring 从 extension（skill 脚本工具、MCP 工具）收集注入。
- **工具协议选文本协议（关键决策）**：模型输出结构化调用标记，loop 解析、执行、回喂。理由：`StreamChat` 接口保持不变，四家 OpenAI 兼容厂商 + forward 转发零改动即可用工具；原生 function-calling 是厂商私有协议，forward 对端（朋友 app）也不保证支持。原生 function-calling 留作后续优化，`Tool` 接口已预留。
- 标记语法（JSON 块 vs XML 标签）与解析实现留给实施计划选型，本节只锁「文本协议 + Tool 接口」两个决策。

### 4.3 loop.go——状态机

- **单轮直通**（未注册任何工具时）：一次 `StreamChat` 直出，行为与现 ChatService 逐字节一致——这是本层第一条回归线。
- **工具循环**（注册了工具时）：模型输出 → 解析工具调用 → 执行 → 结果回喂 → 循环；上限 `maxIterations`（默认 6），到达上限强制收尾。
- **工具步骤不吐 delta**：气泡只见最终回复；中间步骤以 `tool_status` 事件外发到 service（是否透传前端见 §12），事件不进 transcript。
- 工具失败回喂错误文本让模型自纠；连续 N（默认 3）次工具失败中止本轮并报错。
- ctx 取消全程即时生效（复用 send/ctx 检查约定）。
- 循环内瞬态（中间工具结果）只存内存，循环结束即弃。

### 4.4 event.go——LoopEvent

`LoopEvent{Delta, ToolStatus, Done, Err}` → service 经 MotionFilter 转现有 SSE `Event` 协议（type: meta/delta/motion/done/error）。**MotionFilter 留 service**：动作协议解析是桌宠渲染关注点，不进 harness。

## 5. 记忆管理（lovely-agent/memory）

### 5.1 memory.go——接口

```go
type Memory interface {
    Retrieve(ctx context.Context, query string, topK int) ([]MemoryItem, error) // 检索注入
    Remember(ctx context.Context, sessionID string, msgs []Message)             // 触发抽取回写
}
```

无实现时 service 注入零依赖空实现（检索返回空、回写空操作）——记忆能力缺席不阻断对话。

### 5.2 context.go——记忆构建

检索注入逻辑：以最新用户输入为 query 调 `Retrieve` → 结果组装为 prompt 记忆段（稳定前缀中的「检索记忆」段，延续 design.md §4 顺序）。构建逻辑在此文件，不散落在 agent 的 context 里。

### 5.3 extract.go——抽取编排（M5）

对话完成 → 异步抽取 → sha256 去重（cosine > 0.90 合并）→ 批量嵌入 → 回写。触发由 service 在 loop done 后调用 `Remember`（fire-and-forget）——memory 不主动挂任何事件。

### 5.4 store.go——存储抽象

`Store` 接口（写/检索/去重）；pgvector 实现由 service wiring 注入 `internal/db` 的 DAO——**harness 不 import 存储层**。

### 5.5 记录 vs 脑

db 里的对话历史与记忆条目是记录（transcript / knowledge），不是推理状态。推理状态只存在于接入端大脑（forward 对端 / 模型厂商）。memory 文件夹不保存循环瞬态。

## 6. 扩展层（lovely-agent/extension）

### 6.1 skill/——Claude Code 式声明包

- `loader.go`：技能发现（目录扫描）+ 解析（skill.md frontmatter：name/description/触发条件 + 指令正文）。
- `skill.go`：产出指令注入片段（供 agent/context 技能段）；技能可声明脚本工具（适配 agent.Tool 进 ToolRegistry）。
- 加载失败降级：单个技能损坏只跳过该技能并记日志，不阻断对话。

### 6.2 mcpclient/——MCP 调用方

go-sdk 客户端（stdio + streamable-http，design.md §5.1 已选型），把外部 MCP 工具适配为 agent.Tool。与 skill 同权：都只是 ToolRegistry 与指令的来源。

### 6.3 安全

- 技能与 MCP 工具执行前声明式白名单（工具 Description 兜底 + 可选确认）。
- 工具执行错误脱敏：密钥不进错误文案（全 harness 契约 §9）。
- 无任何 shell/文件系统工具（沿用 design.md §5.4 红线）。

## 7. 服务包装与 service 重组

- **internal/mcp**：design.md MB 方向不变——`pet_speak`/`pet_emote`/`pet_notify`/`pet_get_state` 四工具，stdio 免 token、HTTP 强制 token，无状态薄壳调 service（WS 推 renderer 播报）。
- **service**：`Chat` 入口重组为「组装 Loop 的入口」——wiring 全部具体实现（ContextConfig、工具、记忆），收 LoopEvent 经 MotionFilter 转 SSE、落 transcript。MotionFilter、memstore（会话/history 存储）、主动搭话触发（M6：cron/WS idle/冷却时段，service 层）留 service。

## 8. 数据流

1. **直接对话**：renderer SSE → controller → service.Chat → agent.Loop → context（persona + 历史 + 技能 + 记忆）→ model（openai_compat 或 forward → 朋友 app 的脑）→ delta → MotionFilter → SSE → 气泡；transcript 落库在 service。
2. **工具调用**：loop 内解析标记 → ToolRegistry → skill 脚本 / 外部 MCP → 回喂 → 续循环；tool_status 事件旁路到前端。
3. **宿主调用**：Codex/Harness → internal/mcp（stdio）→ service → WS → renderer 播报。

## 9. 错误契约（三层）

- **模型层**：docs/forward-provider.md §4.8 原样——ctx 取消静默关通道；仅 `ctx.Err() == nil` 时发 Err；密钥/URL query 不进错误文案。
- **loop 层**：工具失败回喂可自纠；连续 N 次失败中止；中止与上游错误文案同样脱敏。
- **扩展层**：技能/MCP 加载失败降级（跳过该技能/工具并记日志），不阻断对话。

## 10. 测试策略

- loop：fake provider + fake tools——单轮直通、工具循环、迭代上限、连续失败中止、ctx 停止全覆盖。
- memory：fake Store 测构建/去重/回写编排；真 DAO 的 pgvector 测试在 store 实现侧。
- extension：fixture 技能目录（含损坏技能）+ 假 MCP server。
- context：注入顺序快照式断言。
- 回归线：单轮直通路径逐字节比对现有 chat 测试（迁移后全绿为准）。

## 11. 迁移路径与里程碑映射

实施顺序（本设计只定顺序，各步另立计划）：

| 步 | 内容 | 对应里程碑 |
|---|---|---|
| 1 | 包迁移：llm → lovely-agent/model（+forward 子包）；建 agent/memory/extension 骨架与接口（零新行为） | 纯重构 |
| 2 | service 重组：prompt 构建 → agent/context，ChatService → Loop 单轮直通入口；现有 chat 测试迁移后全绿 | 纯重构 |
| 3 | internal/mcp 落服务包装（四工具 + WS 播报链路） | MB |
| 4 | 扩展层落地：skills 加载/注入 → mcpclient 适配 | 新增（未排期） |
| 5 | 工具循环：文本协议解析 + ToolRegistry + 循环状态机 | 新增（未排期） |
| 6 | memory：internal/db DAO 实现 Store + 抽取/嵌入/检索管线 | M5 |
| 7 | 主动搭话：service 定时触发 Loop（冷却/时段/随机门在 service） | M6 |

## 12. 开放问题（实施计划时决策）

- 工具协议标记的具体语法（JSON 块 / XML 标签）与解析实现。
- skills 触发条件的匹配算法（描述检索 / 关键词）。
- `tool_status` 是否透传到前端（气泡旁显示「正在使用工具」）。
- 嵌入厂商默认值（design.md §4 智谱 embedding-3）与 forward 场景下 embedding 是否复用接入端大脑，实施 M5 时决策。

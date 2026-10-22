# lovely-buddy 技术文档（产品形态 v2）

> 状态：草案 v0.1（2026-10-15）｜取代旧版 skyi-buddy 计划
> 本文档是产品的唯一设计基准（spec），实施计划（docs/superpowers/plans/）均引用本文档。

## 1. 产品定位

**lovely-buddy 是一个可换形象的本地 AI 桌宠，也是任何 AI 桌面端（Codex、DeepSeek Harness、Claude Desktop 等）的「表情与嘴替」。**

三个核心能力：

1. **形象系统**：多形象库，用户可导入/下载新的 Live2D 形象并即时热切换（默认形象由用户自备，仓库零资产）。
2. **模型对接**：多厂商 OpenAI 兼容模型（DeepSeek/GLM/Qwen/Kimi），对话 + 长期记忆，厂商可热切换。
3. **宿主接入**：内置 MCP server，接入 Codex / DeepSeek Harness / Claude Desktop 等 AI 桌面端——宿主 agent 调用工具让桌宠说话、做动作、弹通知。

项目形态不变：**开源本地项目，不发布线上下载，用户从源码构建**；仓库不内置任何受版权保护的模型资产（形象版权归其权利人，红线不变）。

## 2. 形态总览

```
┌────────────────────────── 宿主层（AI 桌面端）──────────────────────────┐
│  Codex CLI          DeepSeek Harness        Claude Desktop / Cursor    │
│  [mcp_servers]      [dsh-mcp-client]        [mcpServers]               │
└────────────┬────────────────────┬────────────────────┬────────────────┘
             │ stdio              │ stdio              │ stdio
             ▼                    ▼                    ▼
   ┌───────────── lovely-buddy-mcp（stdio 薄客户端，同一二进制）─────────────┐
   │  pet_speak · pet_emote · pet_notify · pet_get_state                  │
   └──────────────┬──────────────────────────────────────────────────────┘
                  │ HTTP 127.0.0.1:8740（token）——与桌宠后端同地址
                  ▼
   ┌────────────── lovely-buddy-server（Go）──────────────────┐
   │ gin API │ SSE 流式聊天 │ WS │ 记忆抽取/检索 │ provider 注册表 │ 形象库 │
   └─────────────┬────────────────────────┬──────────────────┘
                 │ WS 推送                │ l2d:// 模型资源流
                 ▼                        ▼
   ┌────────── Electron 桌宠窗口（小窗 + 点击穿透）───────────┐
   │ PetCanvas │ 气泡 │ 形象切换器 │ 形象管理/设置面板          │
   └─────────────────────────────────────────────────────────┘
```

- 桌宠窗口 = 小窗口只包住模型（M1 已落地：默认穿透、拖拽移动窗口、位置持久化）。
- MCP 进程是**无状态薄客户端**：工具调用 → 转发后端 HTTP API → 后端经 WS 推给 renderer 播报。形象、会话、记忆等所有状态都只在后端。
- 同一 Go 二进制提供三个入口：`serve`（主服务）/ `mcp --transport stdio` / `mcp --transport http`。

## 3. 形象系统（多形态切换 + 下载自动应用）

### 3.1 形象包规范

形象 = 一个目录，放在模型根目录（dev = 仓库 `model/`，打包 = `userData/models/`）下：

```
models/<slug>/
├── avatar.json            # 元数据（可选；缺失时按目录名兜底）
├── *.model3.json          # Cubism 4 入口（.moc3）
│   或 *.model.json        # Cubism 2 入口（.moc）
└── textures/ motions/ ... # 模型附属资源
```

`avatar.json` 字段（全部可选）：

```json
{
  "name": "haru",
  "author": "user",
  "version": "1.0.0",
  "license": "unknown",
  "homepage": "",
  "persona": "persona/haru.txt"
}
```

- `persona` 指向该形象的专属人设文件（相对形象目录）；缺失则用全局人设。改人设 = 显式弃用该会话缓存前缀（沿用旧设计）。
- 入口探测沿用 M1 的 `listModels`（递归 ≤3 层、跳过点目录），升级为同时读取 `avatar.json`。

### 3.2 下载与导入（决策：URL/zip + 本地导入，不内置任何下载源）

导入管线（后端 `assets` 包）：

1. **来源**：用户粘贴 HTTPS URL（zip），或选择本地目录/zip 文件。
2. **下载**（URL 来源）：大小上限 512MB；超时与重试（2 次）；日志记录来源 URL（审计用）。v1 不做域名白名单（默认允许任意 HTTPS），预留 `allowed_domains` 配置项。
3. **解压校验**：每个 zip entry 做 zip-slip 防护（`resolve` 后必须落在解压目标内）；解压到 staging 目录。
4. **探测**：staging 内找 `*.model3.json`/`*.model.json`（≤3 层）；找不到 → 报错「未找到 Live2D 模型入口」并清理。
5. **入库**：staging 原子 rename 到 `models/<slug>/`（slug 由目录名/文件名生成，冲突自动加后缀）。
6. **自动应用**：导入成功后自动选中新形象（设置项 `auto_apply_avatar`，默认开）。

删除形象：API 删除整个形象目录（二次确认，仅限模型根目录内）。

**API 契约（lovely-buddy-server，Bearer token，仅 127.0.0.1）**：
- `GET /api/v1/assets` → `{avatars: Avatar[]}`（Avatar：slug/name/author/version/license/homepage/persona/source/kind/entry）
- `POST /api/v1/assets/import` body `{source:{type:"url"|"path", value}}` → `{avatar}`（失败 422 `{error}`）
- `DELETE /api/v1/assets/:slug` → `{ok:true}`（非法 slug 400）

导入管线在 Go `internal/assets` 包：staging 解压（zip-slip 防护 + 1GB/2 万条目炸弹上限）→ 解包单层目录 → 入口探测（≤3 层）→ slug 冲突自动加后缀 → 原子 rename → 写 `.lovelybuddy.json` 来源侧车。模型根目录由 `--model-dir` / `LOVELYBUDDY_MODEL_DIR` 指定（默认 `../model`，与 dev 仓库 `model/` 一致）。

### 3.3 形象管理 UI

- 形象切换器升级为**形象卡片列表**：名称、作者、许可、来源（本地/URL）、入口类型；操作：选中（热切换，复用 M1 的 release/load 机制）、删除。
- 「导入形象」入口：贴 URL / 选本地目录或 zip → 进度条 → 完成自动应用。
- 归属 M3 设置面板（或独立面板，见里程碑）。

### 3.4 版权红线（不变，写入 README）

- 仓库、安装包、默认下载源**零第三方模型/语音资产**；开发测试用 Live2D 官方免费素材（shizuku/haru，Free Material License，由 `make assets` 拉取，不入库）。
- 下载功能不预置任何模型下载源；用户自担来源合法性。

## 4. 模型对接（多厂商）

沿用已确认选型，摘要如下（细节见旧计划，不重复展开）：

- **Provider 抽象**：`ChatProvider.StreamChat(ctx, req)` + `EmbeddingProvider.EmbedBatch(ctx, texts)`；唯一实现 `openaiCompat`（`sashabaranov/go-openai` 改 BaseURL），registry 从 config 实例化、热切换。
- **默认厂商**：对话 DeepSeek（缓存友好 prompt 顺序：稳定前缀 = 人设+动作协议 → 历史 → 动态尾块 → 检索记忆 → 最新输入）；embedding 智谱 embedding-3（OpenAI 兼容，`dimensions=1024` 对齐 pgvector/HNSW，插入前断言）。
- **记忆**：SSE 完成后异步抽取 → sha256 去重（cosine > 0.90 合并）→ 批量嵌入 → pgvector 检索注入（fact 且 importance ≥ 8 常驻）。
- **每形象人格**：`avatar.json.persona` 覆盖全局人设（新增能力）。

## 5. 宿主接入（MCP server 模式）

### 5.1 选型

- **实现库**：官方 `modelcontextprotocol/go-sdk`（2025 年起稳定，stdio + streamable-http 双传输；备选 mark3labs/mcp-go，接口雷同）。经 `proxy.golang.org` 拉取，CN 网络可用。
- **传输**：stdio 为主（Codex、DeepSeek Harness、Claude Desktop 均支持）；HTTP（streamable-http）为辅，供远程/桌面宿主。
- **进程模型**：`lovely-buddy-server mcp` 子命令，与主服务同一二进制；stdio 模式无 token（stdin/stdout 私有通道，进程级本地信任），HTTP 模式强制 Bearer token（启动随机，env 注入）。
- 工具调用 → `POST http://127.0.0.1:8740/api/mcp/tool`（token 鉴权）→ 后端校验 → WS 推 renderer 播报。MCP 进程不持有任何状态。

### 5.2 工具面（v1）

| 工具 | 参数 | 行为 |
|---|---|---|
| `pet_speak` | `text: string`, `motion?: string`, `avatar?: string` | 气泡显示文本；`motion` 传动作组名（模型无此动作时静默忽略，回退 idle）；`avatar` 可选切换形象 |
| `pet_emote` | `motion: string` | 仅播动作 |
| `pet_notify` | `title: string`, `body: string` | 气泡 + 系统通知（标题必填，正文 ≤ 500 字） |
| `pet_get_state` | — | 返回 `{avatar, status, version}`，供宿主判断桌宠在线状态 |

- 工具名与 description 面向 agent 优化（英文 description + 中文示例）。
- v1 **不写入记忆**：宿主消息只播报，不污染用户与桌宠的聊天历史（配置项 `mcp.persist_host_messages`，默认 false）。
- v2 预留：`pet_ask`（人机回路：agent 提问 → 用户输入回传）、`pet_memory_search`。

### 5.3 宿主配置示例

**Codex CLI**（`~/.codex/config.toml`，transport 由字段推断：有 `command` 即 stdio；Codex 不支持独立 SSE）：

```toml
[mcp_servers.lovelybuddy]
command = "/path/to/lovely-buddy-server"
args = ["mcp", "--transport", "stdio"]
```

或命令行：`codex mcp add lovelybuddy -- /path/to/lovely-buddy-server mcp --transport stdio`。

**DeepSeek Harness**（agent 预设 `agent.cordis.yml` 中挂 `@deepseek-ai/dsh-mcp-client` 插件实例；工具名形如 `mcp__lovelybuddy__pet_speak`，serverName 须唯一）：

```yaml
# user preset（<DSH_HOME>/.agent-presets/）中增加 MCP client 实例
- plugin: '@deepseek-ai/dsh-mcp-client'
  config:
    servers:
      - name: lovelybuddy
        command: /path/to/lovely-buddy-server
        args: [mcp, --transport, stdio]
        failOnStartupError: false
```

> DeepSeek Harness 处于 developer preview（v0.1.x），配置字段可能变动，接入时以官方仓库 README 为准。

**Claude Desktop / Cursor / 其他**：任何支持 MCP stdio 的宿主，同一 server 通吃，配置方式为各宿主的通用 mcpServers 声明。

### 5.4 安全

- 只绑 127.0.0.1；HTTP 模式强制 token；stdio 免 token（本地进程信任边界）。
- 工具入参校验（长度上限、motion 白名单式校验不强制——未知动作静默回退）；无任何 shell/文件系统工具。
- 日志脱敏：不记录消息正文（仅 tool 名、长度、耗时）。

## 6. 改名迁移清单（skyi-buddy → lovely-buddy）

| 项 | 旧 | 新 |
|---|---|---|
| 产品名/文档 | skyi-buddy | lovely-buddy |
| Go module / 二进制 / cmd 目录 | `skyi/server`、skyi-server、`cmd/skyi-server` | `lovelybuddy/server`、lovely-buddy-server、`cmd/lovely-buddy-server` |
| Electron 包名 / userData 目录 | skyi-desktop | lovely-buddy（dev 下 settings 重建可接受） |
| IPC 通道前缀 | `skyi:*` | `lovelybuddy:*` |
| preload 全局 | `window.skyi` | `window.lovelybuddy` |
| env | `SKYI_ADDR`/`SKYI_DEV_TOKEN` | `LOVELYBUDDY_ADDR`/`LOVELYBUDDY_DEV_TOKEN` |
| compose 容器名 | skyi-postgres | lovelybuddy-postgres（**卷名不变**，避免数据迁移） |
| 资源协议 | `l2d://` | **保留**（语义与 Live2D 绑定，无品牌含义） |
| 仓库目录 | …/skyi-buddy | …/lovely-buddy（可选：停 dev 后 `mv`，git 自动跟随） |

改名是纯机械重构：全局替换 + `make test` 全绿 + 冒烟。先于所有新功能执行。

## 7. 里程碑重排

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **MR 改名** | 上表全部替换，README 重写（新定位 + 版权声明） | `make test` 全绿；dev 冒烟正常 |
| **M2 流式聊天**（原 #3） | SSE 全链路、打字机气泡、`[motion:]` 解析触发+剥离入库、历史、停止、断线恢复 | 流式不卡顿；库里 content 干净；重启历史完整 |
| **MA 形象系统** | avatar.json、下载/导入/删除管线（zip-slip 防护）、热切换、自动应用 | 贴 URL 下载→自动切换；恶意 zip 被拒；删除后列表即时刷新 |
| **M3 设置面板**（含形象管理 UI） | /api/config、厂商切换、key 写 .env、连通测试、形象卡片管理、motion 映射 | 切 provider 免重启生效；test-llm 明确成败；非法配置拒绝不落盘 |
| **MB MCP 宿主接入** | mcp 子命令、4 个工具、WS 播报链路、Codex/Harness 接入文档 | 宿主调 `pet_speak` 桌宠开口；HTTP 模式无 token 拒绝；stdio 无残留进程 |
| **M4 打包守护 → v0.1**（原 #5） | electron-builder、extraResources、spawn/重启/回收、随机 token | 双击 10s 内出现；kill Go 5s 内恢复；退出 pgrep 为空 |
| **M5 记忆 →**（原 #6） | 迁移 000002、写入管线、检索注入、缓存、总结 | 跨会话复述；相似度合并不重复；同文本二次嵌入零 API 调用 |
| **M6 主动搭话 → v0.2**（原 #7） | cron、WS idle 检测、冷却/时段/随机门 | 空闲开口带上下文；冷却不打扰；夜间静默 |

v0.1 = MR + M2 + MA + M3 + MB + M4；v0.2 追加 M5 + M6。

v2 方向（本文档记录，不排期）：监听模式（读宿主 session 记录自主反应）、`pet_ask` 人机回路、社区形象清单仓库（如未来需要）。

## 8. 关键风险

1. **DeepSeek Harness 是 developer preview**：MCP 插件字段可能破坏性变更 → 接入文档标注「以官方为准」，接入测试只做 stdio 握手 + 工具列表，不锁死配置细节。
2. **Codex 不支持独立 SSE 传输** → 主推 stdio（MCP 进程本地 spawn），规避 SSE 桥接。
3. **zip-slip / SSRF**：解压必须逐 entry 校验路径；URL 下载默认 HTTPS-only，预留域名白名单。
4. **多形象切换**：M1 已知 fork 的 destroy 抛错已兜底（try/catch + 幂等 facade）；热切换复用它，切换失败可回退上一形象。
5. **MCP go-sdk 迭代快**：锁 minor 版本，CI 集成测试（stdio 启动 + 初始化握手 + list_tools）兜底。
6. **改名遗漏**：IPC 前缀/env/目录引用散落主进程、preload、renderer、测试——用 `make test` + 全局 grep `skyi` 双保险（协议名 l2d 除外）。

## 9. 开放问题（后续决策）

- 形象下载的 HTTPS 域名白名单是否默认收紧（v1 先全放行 + 日志审计）。
- `pet_notify` 是否也走 macOS 系统通知（UserNotification），v1 仅气泡。
- 每形象专属人格的优先级细节（形象 persona > 全局 persona > 会话内设定）。

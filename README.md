# skyi-buddy —— 洛天依 AI 桌宠

本地运行的开源 AI 桌宠：洛天依 Live2D 形象常驻桌面，支持流式聊天与长期记忆。

> ⚠️ **版权声明**：本仓库不含任何洛天依模型/音色资产。洛天依形象与声库版权归上海禾念（Vsinger）所有，
> 模型文件请用户自行获取并放入 `model/` 目录，本仓库仅提供加载器。请遵守模型作者的使用条款，勿用于商业用途。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron（透明置顶窗口 + 托盘） |
| 前端 | React 18 + Vite + pixi.js v7 + pixi-live2d-display |
| 后端 | Go + gin（SSE 流式 / WebSocket） |
| 存储 | PostgreSQL + pgvector（Docker Compose，仅绑 127.0.0.1） |
| 模型 | OpenAI 兼容 API：DeepSeek / 通义 / GLM / Kimi 等国产模型 |

## 快速开始

```bash
git clone <本仓库> && cd skyi-buddy
cp .env.example .env    # 填入 DEEPSEEK_API_KEY（对话）、SILICONFLOW_API_KEY（记忆，可选）
make setup              # 安装依赖、生成图标
make dev                # 一键启动：数据库 + Go 后端 + Electron
```

首次渲染模型：把 Live2D 模型目录放入 `model/`（格式见 [docs/model-setup.md](docs/model-setup.md)）。
`make setup` 会顺带下载 Cubism core 与官方免费示例模型 shizuku（Cubism 2）/haru（Cubism 4）用于开发测试（Live2D Free Material License，不随仓库分发）；之后可随时 `make assets` 单独重下。
无 API Key 时桌宠可显示、但无法聊天与记忆。

## 目录

```
apps/desktop/   Electron 前端（渲染器/主进程/preload）
server/         Go 后端（gin + pgvector + LLM provider 抽象）
model/          Live2D 模型目录（gitignore，用户自备）
docs/           架构 / 配置 / 模型放置 / 开发打包文档
```

## 开发

```bash
make test            # Go vet/test + 前端类型检查与测试
make build-server    # 编译 Go 二进制
make build           # 打包 macOS 应用（未签名，仅本地使用）
```

### 测试与提交约定

- **测试位置**：前端测试放在功能目录下的 `__test__/` 中；Go 测试文件与源码同目录
  （`*_test.go`，注意 Go 工具链会忽略 `_` 开头的目录，故无法使用 `__test__/` 目录名）。
- **Commit**：遵循 Conventional Commits（`feat:` / `fix:` / `chore:` / `test:` 等），
  由 commitlint + husky 在本地强制，PR 侧由 CI 复核。
- **CI**：GitHub Actions 跑 Go vet/test（pgvector 服务）、前端 typecheck/vitest/build、commitlint。

详见 [docs/development.md](docs/development.md)。本项目只面向开发者从源码构建，不发布线上下载。

## 许可

代码以 MIT 协议开源。洛天依形象/声库版权归上海禾念所有，与本项目无关。

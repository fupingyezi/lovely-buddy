.DEFAULT_GOAL := dev
SHELL := /bin/bash
GOBIN := $(shell go env GOPATH)/bin

.PHONY: setup db dev test build-server build clean

setup: ## 首次克隆后执行：安装依赖、生成图标、初始化 .env
	pnpm install
	cd server && go mod download
	go install github.com/air-verse/air@latest
	node scripts/gen-tray-icon.mjs
	@test -f .env || cp .env.example .env
	@echo ""
	@echo "✔ 初始化完成。请把 Live2D 模型放入 model/ 目录（见 docs/model-setup.md），"
	@echo "  并在 .env 中填入 DEEPSEEK_API_KEY（对话）与 SILICONFLOW_API_KEY（记忆）"

db: ## 启动 PostgreSQL（pgvector），已启动则跳过
	docker compose up -d --wait

dev: db ## 一键开发：Go(air 热重载) + Electron(electron-vite 热更)
	pnpm exec concurrently -k -n go,desktop -c green,magenta \
		"cd server && $(GOBIN)/air" \
		"pnpm exec wait-on -t 30000 http-get://127.0.0.1:8740/healthz && cd apps/desktop && pnpm dev"

test: ## Go vet/test + 前端类型检查与测试
	cd server && go vet ./... && go test ./...
	cd apps/desktop && pnpm typecheck && pnpm test

build-server: ## 编译 Go 后端 → apps/desktop/resources/bin/（darwin-arm64）
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" \
		-o ../apps/desktop/resources/bin/skyi-server-darwin-arm64 ./cmd/skyi-server

build: build-server ## 打包 macOS 应用（未签名，仅本地使用）
	cd apps/desktop && pnpm dist

clean:
	rm -rf dist server/bin server/tmp apps/desktop/out

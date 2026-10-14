#!/usr/bin/env bash
# 下载 Live2D 渲染所需的资产（不提交仓库）：
#   1. Cubism core（UMD 脚本）→ apps/desktop/public/live2d/
#   2. 官方免费示例模型（仅开发测试用）→ model/
# 洛天依模型请用户自行获取并放入 model/（版权归上海禾念）。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# electron-vite 的 renderer 根是 src/renderer，public 目录随之在 src/renderer/public
CORE_DIR="$ROOT/apps/desktop/src/renderer/public/live2d"
MODEL_DIR="$ROOT/model"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$CORE_DIR" "$MODEL_DIR"

echo "== Cubism cores → $CORE_DIR"
# Cubism 4 core（.moc3）：官方 CDN，失败回退 npm 镜像源
if [ ! -s "$CORE_DIR/live2dcubismcore.min.js" ]; then
  curl -fSL --connect-timeout 10 -o "$CORE_DIR/live2dcubismcore.min.js" \
    "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js" \
    || curl -fSL -o "$CORE_DIR/live2dcubismcore.min.js" \
      "https://unpkg.com/live2d-lib@1.0.9/live2d/core/live2dCubismCore.min.js"
fi
# Cubism 2.1 core（.moc）：npm 镜像源（GitHub 直连不可用）
if [ ! -s "$CORE_DIR/live2d.min.js" ]; then
  curl -fSL --connect-timeout 10 -o "$CORE_DIR/live2d.min.js" \
    "https://unpkg.com/vue-live2d@1.3.8/src/lib/live2d.min.js"
fi
ls -la "$CORE_DIR"

echo "== 官方免费示例模型（Live2D Free Material License，仅开发测试）→ $MODEL_DIR"
# 直接拉 registry 标准 tarball 路径（默认 npmmirror，可 NPM_REGISTRY 覆盖）
REG="${NPM_REGISTRY:-https://registry.npmmirror.com}"
curl -fSL --connect-timeout 10 -o "$TMP/shizuku.tgz" \
  "$REG/live2d-widget-model-shizuku/-/live2d-widget-model-shizuku-1.0.5.tgz"
curl -fSL --connect-timeout 10 -o "$TMP/live2d-lib.tgz" \
  "$REG/live2d-lib/-/live2d-lib-1.0.9.tgz"

# shizuku（Cubism 2，.moc）：以模型文件存在为准，避免残留空目录导致跳过
if [ ! -f "$MODEL_DIR/shizuku-cubism2/shizuku.model.json" ]; then
  mkdir -p "$MODEL_DIR/shizuku-cubism2"
  tar xzf "$TMP/shizuku.tgz" \
    -C "$MODEL_DIR/shizuku-cubism2" --strip-components=2 package/assets
fi
# haru（Cubism 4，.moc3）
if [ ! -f "$MODEL_DIR/haru-cubism4/haru.model3.json" ]; then
  mkdir -p "$MODEL_DIR/haru-cubism4"
  tar xzf "$TMP/live2d-lib.tgz" \
    -C "$MODEL_DIR/haru-cubism4" --strip-components=3 package/resources/haru
fi

echo "完成："
echo "  cores: $CORE_DIR"
echo "  models: $(ls "$MODEL_DIR" | tr '\n' ' ')"
echo "提示：洛天依模型请放入 $MODEL_DIR/<任意目录>/，支持 *.model3.json（.moc3）与 *.model.json（.moc）"

# 模型放置与导入

AI桌宠仓库零模型资产，形象由用户自备。两种方式：放入 `model/` 目录，或应用内导入。

## 1. 放入 model/ 目录

```
model/
└── <slug>/            # 形象目录，目录名即 slug
    ├── avatar.json    # 可选：元数据
    ├── *.model3.json  # Cubism 4 入口（自动探测，优先）
    └── *.model.json   # Cubism 2 入口
```

- **入口自动探测**：在形象目录内递归 ≤3 层查找 `.model3.json`（Cubism 4）或 `.model.json`（Cubism 2），找到即视为有效形象；点目录（`.` 开头）跳过。
- 放入后点击应用内「重新扫描」，或在形象菜单中切换。

### avatar.json 字段（全部可选）

| 字段 | 说明 |
|---|---|
| `name` | 显示名（缺省用 slug） |
| `author` / `version` / `license` / `homepage` | 展示在形象卡片上 |
| `persona` | 人设文件相对路径（相对形象目录；文件不存在则回退全局人设，不报错） |

## 2. 应用内导入

形象菜单 → 导入形象：

- 粘贴 HTTPS zip 链接（下载后解压导入）
- 选择本地 zip 或目录

导入成功后自动应用新形象，无需重启。导入来源记录在形象目录的 `.lovelybuddy.json` 侧车文件中。

## 开发测试用官方免费示例

`make assets` 下载 Live2D 官方免费素材 shizuku（Cubism 2）/haru（Cubism 4）到 `model/`（Live2D Free Material License，仅供开发测试，不随仓库分发）。

## 版权

形象版权归其权利人所有，请遵守形象作者的使用条款，勿用于商业用途。

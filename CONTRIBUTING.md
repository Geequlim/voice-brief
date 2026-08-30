# 贡献指南

感谢关注 Voice Brief。

## 环境准备

- Node.js `>= 24`
- Yarn 4（仓库通过 `.yarnrc.yml` 的 `yarnPath` 固定版本，系统 yarn 1.x 亦可直接使用）
- Cinnamon 扩展开发与测试需要 GJS（`gjs` 命令）

```bash
git clone https://github.com/Geequlim/voice-brief.git
cd voice-brief
yarn install
yarn tiny list
```

## 开发命令

所有检查、测试、构建、打包入口均由 Tiny selector 提供，不直接调用底层工具：

| 命令 | 用途 |
| --- | --- |
| `yarn tiny lint` | Oxlint / ESLint / 零内部依赖检查 |
| `yarn tiny lint/fix` | 自动修正 lint 问题 |
| `yarn tiny lint/typecheck` | TypeScript 类型检查 |
| `yarn tiny test` | 单元与集成测试 |
| `yarn tiny test/cinnamon` | Cinnamon 扩展 GJS 测试 |
| `yarn tiny compile` | 生产构建（CLI + Cinnamon） |
| `yarn tiny package` | 组装 npm staging 并校验 |
| `yarn tiny test/package/cli` | CLI tarball 隔离安装验证 |
| `yarn tiny develop/cli` | watch 模式构建 |

## 提交规范

- 提交信息使用 `type: summary` 格式，常用 type：`feat`、`fix`、`refactor`、`build`、`ci`、`docs`、`test`、`chore`。
- pre-commit 钩子会执行 lockfile 校验与 lint 自动修复，请把钩子修正后的文件一并提交。
- 每次提交前保证 `yarn tiny lint` 与 `yarn tiny test` 通过。

## 代码规范

- 缩进使用 Tab，换行 LF，字符串单引号，语句末尾分号。
- 导入优先使用命名导出与 `import type`（由 Oxlint / ESLint 强制）。
- CLI 行为（子命令、参数、帮助文本、退出码）是对外契约，改动需附带快照测试更新说明。

## 行为兼容性承诺

CLI 帮助文本、`status --json` 结构、YAML 配置格式、Hook 协议 v2 与 Cinnamon UUID 属于兼容性承诺。如需变更，请在 issue 中先讨论方案。

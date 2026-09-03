# Voice Brief

本机语音简报工具。它把编码 agent 的最终回复或任务过程状态合成为语音播放，让你在不持续盯着屏幕的情况下了解任务进展。内置多 TTS provider、常驻 daemon、节流与缓存、Hook 事件分发，以及 Cinnamon 桌面对话气泡扩展。

## 演示

[点击此处打开演示](https://github.com/user-attachments/assets/f0ca86ee-7a6e-424e-a659-20895fc2b714)

## 特性

- 一条命令播报：`voice-brief speak <文本>`，支持最终简报与过程播报两种模式。
- 多 provider 与回退：audiocpp、Fish Audio、OpenAI、Edge，失败自动切换 fallback。
- 常驻 daemon：合成与播放排队执行，容量拒绝与进度节流，音量 ducking。
- Markdown 人设：以 front matter 定义语气、音色与音量，可内置可自定义。
- Hook 事件：Unix Domain Socket / Named Pipe 分发 `playback.*` 事件，至多一次投递。
- 可选逐字对齐：音频就绪后并行请求逐字对齐信息，可用于类 karaoke 字幕或可视化进度条。
- Agent 集成：一键向 Codex、Claude、OpenCode、Copilot、Pi、Kimi Code、ZCode 注入提示词与 Skill。
- Cinnamon 扩展：桌面右下角对话气泡展示播报内容。

## 安装

要求 Node.js `>= 24`。

```bash
npm install -g @tinyaxis/voice-brief
```

验证安装：

```bash
voice-brief --version
voice-brief doctor
```

## 快速入门

```bash
# 初始化配置目录与内置人设
voice-brief init

# 播放一条简报
voice-brief speak "任务完成，测试全部通过"

# 开关语音简报
voice-brief on
voice-brief off
voice-brief toggle

# 查看状态（含 JSON 输出）
voice-brief status
voice-brief status --json
```

## 配置

配置目录遵循 XDG 规范，默认位于 `~/.config/voice-brief/`：

- `config.yaml`：全局配置（provider、fallback、并发、hook 等）。
- `personas/`：Markdown 人设文件，front matter 声明展示角色与 provider 参数。

```yaml
provider: audiocpp
fallbackProvider: fish
alignment:
  enabled: true
  provider: audiocpp
  audiocpp:
    baseUrl: http://127.0.0.1:8080/v1
    model: qwen3-align
    language: zh
providers:
  fish:
    apiKeyEnv: FISH_API_KEY
  openai:
    apiKeyEnv: OPENAI_API_KEY
hooks:
  - id: cinnamon
    transport: unix
    socket: /run/user/1000/voice-brief/cinnamon.sock
```

`alignment` 默认关闭，且不属于 TTS provider。打开后，TTS 音频一准备好就会照常进入播放队列；对齐结果若赶上 `playback.ready` 会随该事件发送，否则只会在该条 brief 正处于准备或播放状态时补发 `audio.alignment.ready`。对齐失败不会触发 TTS fallback 或中断播放。

本地 audio.cpp 启动后，可运行 `yarn tiny develop/alignment-smoke` 上传仓库 fixture 并校验对齐结果。该冒烟测试不启动播放器，也不会触发 ducking。

人设示例：

```markdown
---
name: 默认中文助理
providers:
  fish:
    volume: 1
---
你是语音简报人设，用随和的中文口语播报任务状态。
```

## Provider

| Provider | 说明 | 关键配置 |
| --- | --- | --- |
| `audiocpp` | 本地 audio.cpp 服务 | `baseUrl`、`model` |
| `fish` | Fish Audio 云端 TTS | `FISH_API_KEY` |
| `openai` | OpenAI Speech | `OPENAI_API_KEY`、`voice`、`format` |
| `edge` | Edge TTS | `voice`、`rate` |
| `mock` | 不发声，用于测试 | `outputText` |

查看当前可用 provider：`voice-brief provider list`。环境检查：`voice-brief doctor`。

## Agent 集成

把语音简报协议注入编码 agent 的全局提示词与 Skill：

```bash
# 安装（persona 可省略扩展名）
voice-brief install 默认中文助理 zcode
voice-brief install 默认中文助理 claude

# 预览将要修改的文件
voice-brief install 默认中文助理 codex --dry-run

# 卸载
voice-brief uninstall zcode
```

支持目标：`codex`、`claude`、`opencode`、`copilot`、`pi`、`kimi-code`、`zcode`。

## daemon

首次 `speak` 时自动拉起常驻 daemon（kkrpc over Unix Domain Socket），负责排队、节流、缓存与 ducking。

```bash
# 调整播放器启动延迟
voice-brief runtime configure --playback-start-delay-ms 800

# daemon 版本不匹配时自动切换
voice-brief status --json
```

## Cinnamon 扩展

Linux Cinnamon 桌面可安装对话气泡扩展：

```bash
npm install -g @tinyaxis/voice-brief-cinnamon
```

安装后扩展文件位于 `~/.local/share/cinnamon/extensions/voice-brief@tinyaxis`，在 Cinnamon 扩展设置中启用即可。卸载 npm 包不会自动删除扩展文件。

## 开发

本仓库使用 Yarn 4 与 Tiny 快捷指令，所有开发操作通过 Tiny selector 完成：

```bash
yarn install              # 首次恢复依赖
yarn tiny list            # 查看全部快捷指令

yarn tiny lint            # Oxlint / ESLint / 零内部依赖检查
yarn tiny lint/typecheck  # TypeScript 类型检查
yarn tiny test            # 单元与集成测试
yarn tiny test/cinnamon   # Cinnamon 扩展 GJS 测试
yarn tiny compile         # 生产构建
yarn tiny fix-worktree    # 规范化工作区未提交文件

# 打包与发布（独立分组，自动先编译）
yarn tiny publish/package         # 编译并组装 npm staging
yarn tiny publish/package/cli     # 仅编译组装 CLI staging
yarn tiny test/package            # tarball 隔离安装验证
yarn tiny publish/cli             # 编译打包并发布到 npm（需要维护者授权）
```

提交代码前 pre-commit 钩子会自动执行 lockfile 校验与 lint 修复。

## License

[MIT](./LICENSE) © Geequlim

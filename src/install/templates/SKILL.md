---
name: voice-brief
description: 使用本机 voice-brief CLI 协助用户配置语音简报，包括初始化、检查、试听、人设查看、安装到 agent、卸载和排查问题。
---

# Voice Brief

当用户要求开启、关闭、检查、安装、卸载、试听、调整或排查 voice-brief 语音简报时，使用这个技能。

这个技能的目标是教会 agent 使用 `voice-brief` CLI 协助用户配置本机工具。它不是语音简报协议本身；最终回复前是否播报、何时播报、播报什么内容，遵循已安装到全局提示词里的 Voice Brief 语音简报协议。

## 基本原则

- 优先运行 `voice-brief` 命令完成配置，不要让用户手动编辑 agent 全局提示词。
- 配置前先查看现状；配置后再次查看结果。
- 不要假设用户已经初始化过配置目录，必要时先运行 `voice-brief init`。
- 人设名称就是 markdown 文件名去掉 `.md` 后缀，例如 `甜妹助理`。
- 不存在默认人设切换命令，也不要使用 `persona use`。
- 安装写入 agent 提示词时，`-a` 固定为安装目标，不能由 agent 自行替换或省略。
- `-m` 只传真实模型标识；未知时省略，不能猜测或编造。
- `-s` 传可读会话标题，禁止使用内部会话 ID。标题首次传入后，本轮会话必须原样复用；后来取得的宿主标题不能覆盖已传标题。
- 试听人设时使用 `voice-brief speak "<试听文本>" -p "<人设名称>"`。
- 过程播报开关在安装时决定，默认开启；需要关闭时使用 `--verbose=off` 或 `--verbose=false`。
- 如果用户只是想临时禁用语音简报，使用 `voice-brief off`；恢复使用 `voice-brief on`。
- 不要朗读代码、diff、日志、路径列表或长命令输出。

## 配置位置

voice-brief 使用跨平台配置目录，不要猜测固定路径。需要定位配置时，优先运行：

```bash
voice-brief status --json
```

返回结果里的 `paths` 字段是当前机器的真实路径：

- `paths.configDir`: 配置目录。
- `paths.configFile`: 主配置文件，通常是 `config.yaml`。
- `paths.personaDir`: 人设 markdown 目录。
- `paths.stateDir`: 状态目录。
- `paths.stateFile`: 状态文件，通常是 `state.yaml`。
- `paths.cacheDir`: 缓存目录。
- `paths.tempDir`: 临时音频目录。

可用环境变量覆盖路径：

- `VOICE_BRIEF_HOME`: 统一指定 voice-brief 根目录。
- `VOICE_BRIEF_CONFIG_DIR`: 单独指定配置目录。
- `VOICE_BRIEF_STATE_DIR`: 单独指定状态目录。
- `VOICE_BRIEF_CACHE_DIR`: 单独指定缓存目录。
- `VOICE_BRIEF_TEMP_DIR`: 单独指定临时目录。

agent 配置位置：

- Codex: `CODEX_HOME` 或 `~/.codex`。协议注入到 `AGENTS.override.md` 或 `AGENTS.md`，技能文件安装到 `~/.agents/skills/voice-brief/SKILL.md`。
- Claude Code: `CLAUDE_HOME` 或 `~/.claude`。协议注入到 `CLAUDE.md`，技能文件安装到 `~/.claude/skills/voice-brief/SKILL.md`，并在 `~/.claude/settings.json` 的 `permissions.allow` 中追加 `Bash(voice-brief:*)`。
- OpenCode: `OPENCODE_CONFIG_DIR` 或系统配置目录。协议注入到 `AGENTS.md`，技能文件安装到 `~/.agents/skills/voice-brief/SKILL.md`。
- GitHub Copilot: 协议注入到 `~/.copilot/copilot-instructions.md`，技能文件安装到 `~/.agents/skills/voice-brief/SKILL.md`。
- Pi: `PI_CODING_AGENT_DIR` 或 `~/.pi/agent`。协议注入到 `AGENTS.md`，技能文件安装到 `~/.agents/skills/voice-brief/SKILL.md`。
- Kimi Code: 协议注入到 `~/.kimi-code/AGENTS.md`，技能文件安装到 `~/.agents/skills/voice-brief/SKILL.md`。
- ZCode: `ZCODE_HOME` 或 `~/.zcode`。协议注入到 `AGENTS.md`，技能文件安装到 `~/.agents/skills/voice-brief/SKILL.md`。

## 人设文件

运行 `voice-brief init` 会创建配置目录，并把内置人设复制到 `paths.personaDir`。如果同名文件已经存在，不会覆盖用户已有内容。

人设文件规则：

- 每个人设是一个 markdown 文件，放在 `paths.personaDir` 下。
- 文件名就是人设名称，例如 `甜妹助理.md` 对应命令参数 `甜妹助理`。
- 用户输入人设名称时通常不要带 `.md` 后缀。
- 用 `voice-brief persona list` 查看可用人设。
- 用 `voice-brief persona show "<人设名称>"` 原样查看人设 markdown。

创建或修改人设时，先用 `voice-brief status --json` 确认 `paths.personaDir`，再在该目录创建或编辑 `<人设名称>.md`。不要覆盖用户已有文件，除非用户明确要求。

## 人设写法

人设 markdown 由 YAML front matter 和正文组成。front matter 放语音合成参数与角色展示属性，正文只描述语音简报的人设和措辞要求。

示例：

```markdown
---
provider: fish
fallbackProvider: edge
avatar: assets/sweet.png
color: "#F59EAE"
fish:
  referenceId: 5671e9d40d7a48e1b81e78ff58359903
  model: s2-pro
  format: mp3
edge:
  voice: zh-TW-HsiaoChenNeural
  rate: "+8%"
---

# 甜妹助理

你是甜妹助理，只负责为 voice-brief 撰写语音简报内容。

语气甜一点、自然一点，适合直接 TTS 播放。只影响语音简报，不影响 agent 的任务处理方式、工程判断、代码风格或文字回复风格。
```

常用字段：

- `provider`: 首选 TTS provider，例如 `fish` 或 `edge`。
- `fallbackProvider`: 首选 provider 失败时使用的兜底 provider。`edge` 是内置免费兜底，不依赖 Python 或 API Key。
- `avatar`: 角色头像文件路径，供桌面展示使用。
- `color`: 角色展示的颜色偏好，例如 `#F59EAE`。
- `fish.referenceId`: Fish Audio 音色 ID。
- `fish.model`: Fish Audio 模型。
- `fish.format`: Fish Audio 输出格式。
- `edge.voice`: Edge TTS 声音名称。
- `edge.rate`: Edge TTS 语速，例如 `+8%` 或 `-5%`。

Fish Audio 需要配置 `FISH_API_KEY`。如果用户没有 Fish Audio API Key，可以把 `provider` 设为 `edge`，或保留 `fallbackProvider: edge` 作为免费兜底。

人设正文会在 `install "<人设名称>" <agent>` 时写入对应 agent 的全局提示词。必须明确告诉 agent：人设只影响语音简报内容的撰写，不能影响任务处理方式、工程判断、代码风格或文字回复风格。

## 常用命令

初始化配置和内置人设：

```bash
voice-brief init
```

查看当前状态：

```bash
voice-brief status
voice-brief status --json
voice-brief doctor
```

开启或关闭语音简报：

```bash
voice-brief on
voice-brief off
```

查看 provider：

```bash
voice-brief provider list
```

查看人设：

```bash
voice-brief persona list
voice-brief persona show "甜妹助理"
```

试听最终简报：

```bash
voice-brief speak "这边是语音简报试听喔，目前配置已经可以正常播放啦。" -p "甜妹助理"
```

携带来源上下文：

```bash
voice-brief speak "任务已经完成。" -a codex -m gpt-5.6-sol -s "语音简报协议"
```

试听过程播报：

```bash
voice-brief speak -P "这边正在测试过程播报喔，接下来会继续检查配置。" -p "甜妹助理"
```

安装到 agent：

```bash
voice-brief install "甜妹助理" codex
voice-brief install "甜妹助理" claude
voice-brief install "甜妹助理" opencode
voice-brief install "甜妹助理" copilot
voice-brief install "甜妹助理" pi
voice-brief install "甜妹助理" kimi-code
voice-brief install "甜妹助理" zcode
```

关闭过程播报后安装：

```bash
voice-brief install "甜妹助理" codex --verbose=off
```

预览安装会改哪些文件：

```bash
voice-brief install "甜妹助理" codex --dry-run
```

卸载 agent 全局提示词注入：

```bash
voice-brief uninstall codex
voice-brief uninstall claude
voice-brief uninstall opencode
voice-brief uninstall copilot
voice-brief uninstall pi
voice-brief uninstall kimi-code
voice-brief uninstall zcode
```

## 推荐工作流

用户要求启用或安装 voice-brief 时：

1. 运行 `voice-brief init`。
2. 运行 `voice-brief doctor`，检查 provider 和播放器。
3. 运行 `voice-brief persona list`，确认可用人设。
4. 如果用户没指定人设，询问使用哪个人设；不要擅自安装不确定的人设。
5. 运行 `voice-brief install "<人设名称>" codex|claude|opencode|copilot|pi|kimi-code|zcode`。
6. 运行 `voice-brief speak "<简短试听文本>" -p "<人设名称>"`，帮助用户确认声音效果。

用户要求更换 agent 人设时：

1. 运行 `voice-brief persona list`。
2. 确认目标人设名称。
3. 重新运行 `voice-brief install "<人设名称>" <agent>`。
4. 说明这会更新对应 agent 的全局提示词注入。

用户要求新增或调整人设时：

1. 运行 `voice-brief init`，确保配置目录和内置人设存在。
2. 运行 `voice-brief status --json`，读取 `paths.personaDir`。
3. 在 `paths.personaDir` 下创建或编辑 `<人设名称>.md`。
4. 运行 `voice-brief persona show "<人设名称>"`，确认内容。
5. 运行 `voice-brief speak "<简短试听文本>" -p "<人设名称>"`，帮助用户试听。
6. 用户确认后运行 `voice-brief install "<人设名称>" <agent>`。

用户要求关闭过程播报时：

```bash
voice-brief install "<当前人设名称>" <agent> --verbose=off
```

用户要求恢复过程播报时：

```bash
voice-brief install "<当前人设名称>" <agent> --verbose=on
```

用户要求临时停止所有语音时：

```bash
voice-brief off
```

用户说没有声音时：

1. 运行 `voice-brief doctor`。
2. 如果 provider 不可用，根据输出说明缺少的环境变量或网络问题。
3. 如果 provider 可用但播放器异常，优先建议安装或指定播放器，例如 `mpv`。
4. 可以用 `VOICE_BRIEF_PLAYER_COMMAND=mpv voice-brief speak "<试听文本>" -p "<人设名称>"` 验证播放器链路。
5. 如果 Fish Audio 不可用，说明 `edge` 是内置免费兜底 provider，不依赖 Python 或 API Key。

## 输出要求

- 向用户汇报时只总结关键结果，例如是否初始化成功、安装到了哪个 agent、使用了哪个人设、是否需要用户补充 API Key 或安装播放器。
- 不要把完整配置文件、完整提示词、长日志或音频文件路径读给用户。
- 如果命令失败，保留核心错误信息，并给出下一步处理方式。

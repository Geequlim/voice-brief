[English](https://github.com/Geequlim/voice-brief/blob/main/packages/cinnamon/README.md) | 简体中文

# Cinnamon 扩展

Voice Brief 在 Cinnamon 桌面上的官方 Hook 消费者。Voice Brief 播报时，扩展会在主显示器上展示一张对话卡片，包含人设名称、头像和主题色；开启[逐字对齐](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/alignment.md)后还可以跟随音频逐字高亮（KTV 字幕）。

扩展 UUID 为 `voice-brief@tinyaxis`，要求 Linux 上的 Cinnamon 6.6。

## 安装

npm 包内含构建好的扩展，安装时通过 postinstall 自动落位：

```bash
npm install -g @tinyaxis/voice-brief-cinnamon
```

扩展会被复制到 `~/.local/share/cinnamon/extensions/voice-brief@tinyaxis`（遵循 `XDG_DATA_HOME`）。安装过程先写入临时目录、保留旧版备份、成功后再清理，但不会自动启用或重载扩展。

在**系统设置 → 扩展 → Voice Brief** 中启用它。

## 连接 Voice Brief

扩展一旦启用就开始监听 Unix Socket：

```text
$XDG_RUNTIME_DIR/voice-brief/cinnamon.sock
```

典型会话下解析为 `/run/user/1000/voice-brief/cinnamon.sock`，Socket 目录以仅属主可访问的权限创建。在 Voice Brief 配置中注册同一路径（运行 `voice-brief status --json` 可查看当前生效的配置文件）：

```yaml
hooks:
  - id: cinnamon
    transport: unix
    socket: /run/user/1000/voice-brief/cinnamon.sock
    timeoutMs: 1000
```

然后用一条测试播报验证：

```bash
voice-brief speak "Cinnamon overlay check."
```

每个事件在进入界面前都会经过校验（协议版本、事件名、字段类型）；校验失败的事件会被丢弃并记录日志，不影响其他 Hook，也不影响语音播放。完整事件契约见 [Hook 与自定义消费者](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/hooks.md)。

## 显示设置

在**系统设置 → 扩展 → Voice Brief** 中打开扩展设置：

| 设置项 | 可选值 | 默认值 |
| --- | --- | --- |
| 屏幕位置 | 靠顶部（top）、靠底部（bottom） | 靠顶部 |
| 屏幕边距 | 0–512 像素，步进 8 | 112 |

对话卡片只出现在主显示器上，全屏时仍然可见。调整位置会立即作用于当前显示中的卡片。

## 人设外观

名称、头像和主题色来自当前人设的 front matter，与 [TTS 与人设](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/tts-and-personas.md)中说明的是同一组字段：

- `name` — 卡片标题；缺省时显示 `Voice Brief`。
- `avatar` — 本地图片文件路径。文件缺失或不可读时不显示头像，文本卡片直接淡入。
- `color` — 六位十六进制颜色，用于描边、名称和 KTV 高亮；缺省时使用 `#eb4272`。

标题下方的上下文行优先显示会话名称，其次显示 `agent · model`，两者都没有时隐藏。

## 对话行为

- 新播报会播放一段简短的入场动画：头像先弹入，随后对话展开并收尾。
- 排队中的下一条播报会让面板保持可见，并在原位替换内容，只播放一次强调动画。
- 按 `Esc` 或点击卡片上的隐藏按钮可以关闭当前播报；关闭后该播报的后续事件会被忽略，直到它结束。
- 终态事件（`playback.completed`、`playback.failed`、`playback.skipped`、`audio.failed`）会关闭卡片；如果队列中还有下一条，则保持面板等待交接。

## KTV 字幕

逐字对齐可用时，文字会跟随播放进度高亮：未读部分为灰色，当前词加粗并逐渐混入主题色，已读部分保留较浅的主题色调。高亮从 `playback.started` 开始，约每秒刷新 30 次。

- 播放开始后才到达的对齐结果（`audio.alignment.ready`）会立即应用，并直接追赶当前播放进度。
- 没有对齐，或时间轴与播报文本不完全匹配时，卡片显示普通静态文本。缺少高亮不影响音频播放。

## 播放启动延迟

入场动画约 1.2 秒。为了让语音在对话完全展示后再开始，扩展启用时会自动执行：

```bash
voice-brief runtime configure --playback-start-delay-ms 1150
```

这会写入共享的 `playback.startDelayMs` 配置，说明见[基础配置](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/configuration.md)。如果当时 `voice-brief` 可执行文件不在 `PATH` 中，这一步会跳过并记录日志；悬浮层仍正常工作，只是语音可能在动画期间开始。安装 CLI 后把扩展关闭再打开即可补上该延迟。

## 更新与卸载

更新版本：

```bash
npm install -g @tinyaxis/voice-brief-cinnamon
```

postinstall 会替换扩展文件。之后需要重载扩展：在系统设置中切换开关，或执行：

```bash
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon \
  --method org.Cinnamon.ReloadXlet voice-brief@tinyaxis EXTENSION
```

卸载 npm 包不会删除已安装的扩展。要完整移除：

1. 在系统设置中禁用扩展。
2. 删除 `~/.local/share/cinnamon/extensions/voice-brief@tinyaxis`。
3. 从 Voice Brief 配置中移除 `hooks` 条目，并用 `voice-brief runtime configure --playback-start-delay-ms 0` 重置播放延迟。

## 排障

- **卡片不出现。** 确认扩展已启用、Socket 文件存在（`ls "$XDG_RUNTIME_DIR/voice-brief/cinnamon.sock"`），且 Voice Brief 配置中的 `hooks` 条目指向同一路径，然后发送一条测试播报。
- **日志提示播放启动延迟未配置。** 扩展启动时 `voice-brief` 不在 `PATH` 中。安装 CLI 后把扩展关闭再打开。
- **有语音但文字不动。** 对齐不可用或配置有误；悬浮层会按设计退回普通文本，见[逐字对齐](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/alignment.md)。
- **日志提示事件被拒绝。** 事件未通过校验被丢弃；其他 Hook 和音频播放不受影响。

## 开发

在仓库检出目录中：

| 命令 | 用途 |
| --- | --- |
| `yarn tiny develop/cinnamon` | 构建、安装并重载扩展 |
| `yarn tiny develop/cinnamon/install` | 只构建并安装，不重载 |
| `yarn tiny develop/cinnamon/smoke [scenario]` | 视觉冒烟场景（见下） |
| `yarn tiny test/cinnamon` | 扩展 GJS 单元测试 |

源码结构：`src/extension.ts`（生命周期与设置）、`src/dialogue-overlay.ts`（对话界面与事件处理）、`src/lib/protocol.ts`（事件校验）、`src/lib/hook-server.ts`（Unix Socket 服务）、`assets/`（元数据、设置 schema、样式表）。

冒烟场景：`entrance`、`dialogue`、`multiline`、`no-session`、`queue`、`karaoke`、`karaoke-late`，或 `all`（除 KTV fixture 外的全部场景）。场景直接连接运行中的扩展 Socket，因此需要先启用扩展，全程不经过 daemon。可通过 `VOICE_BRIEF_SMOKE_PERSONA` 指定其他人设文件，通过 `VOICE_BRIEF_CINNAMON_SOCKET` 指定其他 Socket。`karaoke` 场景会通过 `mpv` 播放仓库暂存的音频（可用 `VOICE_BRIEF_KARAOKE_PLAYER` 覆盖）；该播放器以 `voice-brief-cinnamon-smoke` 标识自身，被[音频压低](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/linux-ducking.md)排除，因此冒烟测试不会压低其他应用的音量。

## 相关文档

- [Hook 与自定义消费者](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/hooks.md)
- [逐字对齐](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/alignment.md)
- [TTS 与人设](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/tts-and-personas.md)
- [Linux 音频压低](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/linux-ducking.md)
- [基础配置](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/configuration.md)

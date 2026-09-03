[English](https://github.com/Geequlim/voice-brief/blob/main/README.md) | 简体中文

# Voice Brief

Voice Brief 是本机语音简报工具。它把编码 Agent 的最终回复和任务进度合成为简短语音，让你不必一直盯着屏幕。项目内置多种 TTS Provider、Markdown 人设、常驻播放 daemon、Linux 音频压低、生命周期 Hook、可选逐字对齐，以及 Cinnamon 桌面对话气泡。

## 演示

[查看演示视频](https://github.com/user-attachments/assets/f0ca86ee-7a6e-424e-a659-20895fc2b714)

## 安装

Voice Brief 需要 Node.js 24 或更高版本。

```bash
npm install -g @tinyaxis/voice-brief
voice-brief init
voice-brief doctor
```

播放一条简报：

```bash
voice-brief speak "任务完成，测试全部通过。"
```

启用或临时关闭所有简报：

```bash
voice-brief on
voice-brief off
voice-brief toggle
```

## 文档

| 目标 | 文档 |
| --- | --- |
| 了解配置文件、默认值、播放器和缓存 | [基础配置](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/configuration.md) |
| 选择 TTS Provider 或创建人设 | [TTS 与人设](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/tts-and-personas.md) |
| 接入界面或其他事件消费者 | [Hook 与自定义消费者](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/hooks.md) |
| 增加 KTV 式逐字高亮 | [逐字对齐](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/alignment.md) |
| 播报时自动降低其他应用音量 | [Linux 音频压低](https://github.com/Geequlim/voice-brief/blob/main/docs/zh-CN/linux-ducking.md) |
| 在 Cinnamon 桌面显示语音气泡 | [Cinnamon 扩展](https://github.com/Geequlim/voice-brief/blob/main/packages/cinnamon/README.zh-CN.md) |

## 特性

- 一条命令发送最终简报或任务进度。
- 支持 audio.cpp、Fish Audio、OpenAI、Edge TTS 和 mock Provider，并可自动 fallback。
- Markdown 人设控制音色、头像、主题色和简报措辞。
- 常驻 daemon 负责合成、播放队列、节流和缓存。
- Unix Socket 与 stdin Hook 可接入桌面界面或其他消费者。
- 可选逐字对齐，异常时不会阻塞 TTS 或播放。
- Linux PulseAudio/PipeWire 音频压低，并支持异常恢复。
- 一键集成 Codex、Claude、OpenCode、Copilot、Pi、Kimi Code 和 ZCode。

## Agent 集成

把指定人设的简报规则和 Voice Brief Skill 安装到 Agent：

```bash
voice-brief persona list
voice-brief install "默认中文助理" codex --dry-run
voice-brief install "默认中文助理" codex
```

支持的目标包括 `codex`、`claude`、`opencode`、`copilot`、`pi`、`kimi-code` 和 `zcode`。

## 开发

```bash
yarn install
yarn tiny list
yarn tiny lint
yarn tiny test
yarn tiny compile
```

完整开发流程和兼容性约定见 [贡献指南](./CONTRIBUTING.zh-CN.md)。

## License

[MIT](./LICENSE) © Geequlim

[English](../linux-ducking.md) | 简体中文

# Linux 音频压低

在 Linux 上，Voice Brief 可以在播报期间暂时降低其他活动应用的音量，并在播放结束后平滑恢复。音频压低是可选能力，其他平台不会启用。

## 运行条件

- 系统已安装 `pactl`。
- PulseAudio 或 PipeWire-Pulse 兼容服务可以连接。
- 应用在该服务中暴露活动的 sink-input 音频流。

检查支持情况：

```bash
voice-brief doctor
```

压低能力不可用时，Voice Brief 仍会正常播放，只是不调整其他应用音量。

## 配置

```yaml
playback:
  ducking:
    enabled: true
    attenuationDb: 24
    restoreFadeMs: 700
```

| 字段 | 含义 |
| --- | --- |
| `enabled` | 是否启用 Linux 音频压低。 |
| `attenuationDb` | 其他活动音频流降低的幅度，值越大声音越小。 |
| `restoreFadeMs` | 恢复原音量的渐变时间，`0` 表示立即恢复。 |

只关闭压低、不影响播放：

```yaml
playback:
  ducking:
    enabled: false
```

## Voice Brief 会修改什么

播放开始时，Voice Brief 记录活动、未暂停 sink input 的各声道音量，排除自己的播放流，再降低其余音频流。播放结束后恢复每个流原本的精确值。之后才启动的应用不会被盲目写入猜测音量。

Voice Brief 状态目录中的 session journal 会记录等待恢复的项目。如果上一个 daemon 异常退出，后续压低会尝试修复仍然保持 Voice Brief 压低值的音频流；如果用户或其他程序已经改过音量，则不会覆盖新值。

## Cinnamon 冒烟测试

Cinnamon karaoke 冒烟测试直接播放 fixture，并把播放器标记为 `voice-brief-cinnamon-smoke`。压低服务会排除该音频流，而且测试流程不会经过 Voice Brief playback，从而避免表现测试污染应用记忆音量。

## 排障

1. 运行 `voice-brief doctor`，确认音频压低显示为可用。
2. 在目标应用播放声音时，确认它出现在活动 sink input 中。
3. 检查 `voice-brief status --json` 所指配置文件中的 `playback.ducking`。
4. 如果应用在播报期间重启，先让下一次 Voice Brief 播放执行 journal 恢复，再手动修改持久音频规则。
5. 排查播放器或 PipeWire/PulseAudio 时可以先关闭压低；TTS 和播放不依赖它。

不要用视觉或对齐冒烟测试代替真正的压低测试，它们会故意绕过该能力。

## 相关文档

- [基础配置](./configuration.md)
- [Cinnamon 扩展](../../packages/cinnamon/README.zh-CN.md)

[English](../configuration.md) | 简体中文

# 基础配置

Voice Brief 使用 YAML 保存全局运行配置，并把人设放在独立的 Markdown 文件中。首次使用时运行 `voice-brief init`，即可按内置默认值创建两者。

## 查找当前配置文件

不要假定固定的用户目录。用当前进程查询实际路径：

```bash
voice-brief status --json
```

结果包含 `configFile`、`personaDir`、`stateFile`、`cacheDir` 和 `tempDir`。在 Linux 上，配置目录通常是 `~/.config/voice-brief`。

可以用 `VOICE_BRIEF_HOME` 覆盖全部 Voice Brief 路径，也可以分别设置 `VOICE_BRIEF_CONFIG_DIR`、`VOICE_BRIEF_STATE_DIR`、`VOICE_BRIEF_CACHE_DIR` 和 `VOICE_BRIEF_TEMP_DIR`。

## 最小配置

下面的配置使用不需要密钥的 Edge Provider，并关闭可选集成：

```yaml
version: 1
enabled: true
provider: edge
providers:
  edge:
    voice: zh-CN-XiaoxiaoNeural
    rate: +8%
playback:
  command: auto
  ducking:
    enabled: false
```

缺失的段落和字段会与内置默认值合并。未知字段或非法值会直接报错，不会被悄悄忽略。

## 顶层配置

| 字段 | 作用 |
| --- | --- |
| `enabled` | 全局开关，也可通过 `voice-brief on` 和 `voice-brief off` 修改。 |
| `provider` | 默认 TTS Provider。 |
| `fallbackProvider` | 首选 Provider 失败或繁忙时使用的备用 Provider。 |
| `providers` | Provider 地址、模型、凭据、并发和音频参数。 |
| `alignment` | 可选逐字对齐，与 TTS 相互独立。 |
| `hooks` | 生命周期事件消费者。 |
| `playback` | 播放器、界面启动延迟和 Linux 音频压低。 |
| `cache` | 合成音频缓存的容量和过期时间。 |
| `throttle` | 重复与进度简报的节流规则。 |

Provider 和人设字段见 [TTS 与人设](./tts-and-personas.md)。其他可选集成见 [Hook](./hooks.md) 和[逐字对齐](./alignment.md)。

## 播放

`playback.command` 默认为 `auto`，会选择已安装的播放器。设置为 `none` 时仍会合成音频并发送 Hook，但不会播放。环境变量 `VOICE_BRIEF_PLAYER_COMMAND` 可以临时覆盖播放器命令。

部分 Hook 消费者需要在声音开始前播放动画。应通过 daemon 设置这段延迟，让持久配置和当前进程保持一致：

```bash
voice-brief runtime configure --playback-start-delay-ms 800
```

Cinnamon 扩展启用时会自动设置它需要的延迟。

## 缓存和节流

音频缓存默认开启。`ttlMs` 控制过期时间，`maxEntries` 限制保留数量，`pruneIntervalMs` 控制清理频率。缓存键包含文本和最终生效的 Provider 配置，因此切换模型或音色不会复用不兼容的音频。

进度简报会被限流：`progressIntervalMs` 用于普通进度，`highPriorityIntervalMs` 用于高优先级进度，重复文本也可能被跳过。最终简报单独处理。

## 验证配置

```bash
voice-brief status
voice-brief doctor
voice-brief provider list
voice-brief speak "配置检查完成。"
```

`doctor` 会报告播放器、Linux 音频压低、所有 TTS Provider 和最近一次后台播放错误。

## 相关文档

- [TTS 与人设](./tts-and-personas.md)
- [Hook 与自定义消费者](./hooks.md)
- [Linux 音频压低](./linux-ducking.md)

[English](../alignment.md) | 简体中文

# 逐字对齐

逐字对齐是叠加在合成音频之上的可选能力。它提供字符范围和时间戳，用于 KTV 式高亮，但不属于 TTS，也绝不会成为播放前置条件。

## 运行流程

TTS 生成音频文件后，Voice Brief 会立即允许音频进入播放流程，同时开始对齐：

```text
TTS 完成
├── 音频进入播放队列
└── 开始对齐
      ├── 提前完成 → 包含在 playback.ready 中
      ├── 当前播报期间完成 → audio.alignment.ready
      └── 失败或超时 → 继续播放，不显示逐字高亮
```

排队中的条目会暂存提前完成的对齐结果，等它成为当前条目时再随 `playback.ready` 发送。晚到结果只会发给正在准备播放或正在播放的当前条目。不支持对齐的消费者可以完全忽略它。

## 配置 audio.cpp 对齐

```yaml
alignment:
  enabled: true
  provider: audiocpp
  audiocpp:
    baseUrl: http://127.0.0.1:8080/v1
    model: qwen3-align
    language: zh
    timeoutMs: 120000
```

| 字段 | 含义 |
| --- | --- |
| `enabled` | 是否请求对齐，不影响 TTS 是否播放。 |
| `provider` | 对齐 Provider ID，目前是 `audiocpp`。 |
| `baseUrl` | audio.cpp API 地址。 |
| `model` | 对齐请求使用的模型 ID。 |
| `language` | 可选语言提示。 |
| `timeoutMs` | 模型查询、加载和对齐请求的超时。 |
| `apiKeyEnv` | 可选的服务 API Key 环境变量名称。 |
| `family` / `modelPath` | 可选的显式模型来源，优先于自动发现。 |

对齐拥有独立的地址和模型配置。即使 TTS 和对齐都使用 audio.cpp，也不能把两者混为一个 Provider。

## 模型发现和加载

开始对齐前，Voice Brief 会查询 audio.cpp 模型列表。如果指定模型已经加载，就直接开始对齐；否则：

1. 同时配置了 `family` 和 `modelPath` 时优先使用配置。
2. 缺少模型来源时从 audio.cpp 模型目录自动推导。
3. 上传音频前通过 `/models/load` 按 `align` 任务加载模型。

这样 audio.cpp 重启后可以自动恢复。模型无法发现或加载时只会失去逐字效果，TTS 和播放仍然继续。

## 音频准备

audio.cpp 对齐要求 16 kHz、单声道、16-bit 有符号 PCM WAV。TTS 结果已经符合要求时直接上传；其他 WAV 参数和压缩格式会由 `ffmpeg` 转成临时对齐文件，不会替换实际播放的音频。

如果 TTS 输出不符合要求，需要在 Voice Brief 所在机器安装 `ffmpeg`。

## Hook 投递

提前完成的结果位于 `playback.ready.audio.alignment`。晚到结果使用 `audio.alignment.ready`，包含同样的音频信息和对齐数据：

```json
{
  "source": "audiocpp:qwen3-align",
  "cues": [
    { "text": "测试", "startMs": 0, "endMs": 310, "startChar": 0, "endChar": 2 }
  ]
}
```

消费者必须匹配 `briefId`、尊重字符范围，并在结果晚到时按当前播放进度追赶。完整事件契约见 [Hook 与自定义消费者](./hooks.md)。

## 不改变系统音量的验证方式

启动 audio.cpp 后，可以上传仓库 fixture 并校验返回结果：

```bash
yarn tiny develop/alignment-smoke
```

该测试不会启动播放器，也不会调用 Voice Brief 音频压低。

Cinnamon 表现层使用 `develop/cinnamon/smoke/karaoke` 测试提前到达的时间轴，使用 `develop/cinnamon/smoke/karaoke-late` 测试播放期间晚到的时间轴。这些 fixture 直接启动自己的播放器，并绕过 runtime ducking。

## 排障

- 用 `voice-brief status --json` 确认 `alignment.enabled` 和对齐模型 ID。
- 查询 audio.cpp 模型列表，确认配置模型能以对齐任务加载。
- 音频准备失败时确认已经安装 `ffmpeg`。
- 高亮明显过快或过慢时，确认实际上传的对齐 WAV 确实是 16 kHz 单声道 PCM。
- 语音正常但没有高亮时，应优先排查对齐而不是 TTS。

## 相关文档

- [Hook 与自定义消费者](./hooks.md)
- [TTS 与人设](./tts-and-personas.md)
- [Cinnamon 扩展](../../packages/cinnamon/README.zh-CN.md)

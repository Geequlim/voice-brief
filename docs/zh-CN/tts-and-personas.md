[English](../tts-and-personas.md) | 简体中文

# TTS 与人设

全局配置负责描述 Voice Brief 如何访问 TTS 服务；人设负责为某次 `speak` 或某个 Agent 安装选择 Provider，并覆盖音色、视觉身份和简报风格。

## Provider 选择与 fallback

如果人设声明了 `provider`，优先使用人设值，否则使用全局 `provider`。`fallbackProvider` 遵循相同规则。人设中的 Provider 字段会逐项覆盖对应的全局 Provider 字段。

```yaml
provider: fish
fallbackProvider: edge
providers:
  fish:
    apiKeyEnv: FISH_API_KEY
    model: s2-pro
    format: mp3
  edge:
    voice: zh-CN-XiaoxiaoNeural
    rate: +8%
```

密钥应保存在环境变量中。`apiKeyEnv` 填写环境变量名称，不要直接填写密钥。

## Provider

| Provider | 适用场景 | 主要字段 |
| --- | --- | --- |
| `edge` | 无密钥快速配置和 fallback | `voice`、`rate`、`volume` |
| `fish` | Fish Audio 云端音色与参考音色 | `apiKeyEnv`、`model`、`referenceId`、`format`、`volume` |
| `openai` | OpenAI 兼容语音接口 | `apiKeyEnv`、`baseUrl`、`model`、`voice`、`format`、`volume` |
| `audiocpp` | 本地或自托管 audio.cpp | `baseUrl`、`model`、`voice`、`voiceRef`、`referenceText`、`seed`、`volume` |
| `mock` | 不输出音频的测试 | `outputText` |

`concurrency` 只属于全局 Provider 配置。达到并发上限时 Voice Brief 可以尝试 fallback；人设不能修改并发数。

### audio.cpp 模型加载

配置模型 ID 后，Voice Brief 会先查询 `/models`。如果模型未加载，可以从 audio.cpp 模型目录自动发现 family 和路径并加载。显式配置的 `family` 与 `modelPath` 优先于自动发现。

`voiceRef` 可以是服务端引用，也可以是本地 WAV/MP3。相对文件路径从人设目录解析。本地 MP3 在上传前会转为 WAV 并统一响度。

## 人设文件

人设存放在 `voice-brief status --json` 返回的 `personaDir` 中。去掉 `.md` 的文件名就是 CLI 使用的人设名称。

```markdown
---
avatar: assets/assistant.png
color: "#EB4272"
provider: fish
fallbackProvider: edge
fish:
  referenceId: your-reference-id
  model: s2-pro
  format: mp3
edge:
  voice: zh-CN-XiaoxiaoNeural
  rate: +8%
---

# 项目助理

语音简报保持简短、平静。先说明结果，再说明阻塞或下一步。
```

| 字段 | 含义 |
| --- | --- |
| `provider` / `fallbackProvider` | 当前人设的 Provider 路由。 |
| `avatar` | 提供给 Cinnamon 等 Hook 消费者的头像路径。 |
| `color` | 提供给 Hook 消费者的强调色。 |
| `edge`、`fish`、`openai`、`audiocpp` | 当前人设的 Provider 参数覆盖。 |

Markdown 正文会作为语音简报写作规则安装到目标 Agent。它不能改变 Agent 的推理、代码修改方式或普通文字回复风格。

## 管理和试听人设

```bash
voice-brief persona list
voice-brief persona show "项目助理"
voice-brief speak "这是人设试听。" -p "项目助理"
```

正式安装前先预览变更：

```bash
voice-brief install "项目助理" codex --dry-run
voice-brief install "项目助理" codex
```

修改人设正文后需要重新执行 `install`，目标 Agent 才会取得新规则。运行时 front matter 会在人设再次加载时生效。

## 排障

- 用 `voice-brief doctor` 检查服务地址、API Key 环境变量和播放器。
- 用 `voice-brief status --json` 确认实际配置目录和人设目录。
- 可以创建一个直接选择备用 Provider 的人设，单独验证 fallback。
- 声音异常偏小时，同时检查最终生效的 `volume` 和参考音频本身的响度。

## 相关文档

- [基础配置](./configuration.md)
- [逐字对齐](./alignment.md)
- [Cinnamon 扩展](../../packages/cinnamon/README.zh-CN.md)

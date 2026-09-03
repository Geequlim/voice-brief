[English](../hooks.md) | 简体中文

# Hook 与自定义消费者

Hook 把 Voice Brief 生命周期事件发送给桌面界面、日志工具或其他本地集成。它是通知通道：消费者不能通过 Hook 控制 TTS、对齐、排队或播放。

## 配置传输方式

Unix Socket 适合 Cinnamon 等常驻本地消费者：

```yaml
hooks:
  - id: cinnamon
    transport: unix
    socket: /run/user/1000/voice-brief/cinnamon.sock
    timeoutMs: 1000
```

Socket 必须使用绝对路径。在 Linux 上建议使用 `$XDG_RUNTIME_DIR/voice-brief/<consumer>.sock`，并在 YAML 中写入展开后的实际路径。

stdin 传输会为每个事件启动一次命令，并向标准输入写入一行 NDJSON：

```yaml
hooks:
  - id: event-log
    transport: stdin
    command: /usr/local/bin/voice-brief-event-log
    args: [--format, json]
    timeoutMs: 1000
```

多个 Hook 并行投递。连接失败、进程失败或超时只影响对应 Hook，不会把成功的合成或播放变成失败。Hook 不是持久消息队列，错过的事件不会重放。

## 事件生命周期

```text
audio.preparing
    ├── audio.failed
    └── audio.ready
          ↓
      playback.queued
          ↓
      playback.ready
          ↓
      playback.started
          ├── playback.completed
          └── playback.failed
```

`brief.skipped` 表示请求因关闭、空文本、重复或节流被跳过。`playback.skipped` 表示请求已进入流程，但无法播放，例如播放器被关闭。对齐提前完成时包含在 `playback.ready` 中；否则当前播报可能在稍后收到一次 `audio.alignment.ready`。

## 事件信封与上下文

当前协议标识是 `voice-brief.hook-event`，版本是 `2`。

| 字段 | 含义 |
| --- | --- |
| `eventId` | 本次事件的唯一 ID。 |
| `occurredAt` | Voice Brief 生成的 ISO 时间。 |
| `briefId` | 同一次播报共享的稳定 ID。 |
| `sequence` | 同一次播报内递增的事件顺序。 |
| `event` | 生命周期事件名称。 |
| `brief` | 文本、`final`/`progress`/`test` 类型和优先级。 |
| `source` | 可选的 Agent、模型和会话标识。 |
| `persona` | 可选的人设名称、头像和强调色。 |
| `audio` | 可选的 Provider、缓存来源、时长和对齐结果。 |
| `reason` / `error` | 跳过原因或分阶段错误。 |

```json
{
  "protocol": "voice-brief.hook-event",
  "version": 2,
  "eventId": "event-uuid",
  "occurredAt": "2026-09-03T14:00:00.000Z",
  "briefId": "brief-uuid",
  "sequence": 4,
  "event": "playback.ready",
  "brief": { "text": "测试通过。", "kind": "final", "priority": "normal" },
  "source": { "agent": "codex", "session": "完善文档" },
  "persona": { "name": "项目助理", "color": "#EB4272" },
  "audio": { "provider": "audiocpp", "source": "provider", "durationMs": 1840 }
}
```

## 消费者规则

- 用 `briefId` 聚合同一次播报，不要把 `eventId` 当成播报身份。
- 按 `sequence` 应用事件并忽略过期更新。
- 把 `source`、`persona`、`audio`、时长和对齐都视为可选数据。
- 忽略不认识的可选字段和事件，避免附加能力破坏播放。
- 根据当前事件重建可见状态，不要等待历史事件重放。
- 只有 `briefId` 与当前播报一致时才应用晚到的对齐信息。

stdin 命令每次只收到一个 NDJSON 事件。常驻界面应优先使用 Unix Socket，并在修改界面状态前校验事件。Cinnamon 扩展是处理队列激活、晚到对齐和播放终态的参考消费者。

## 相关文档

- [逐字对齐](./alignment.md)
- [Cinnamon 扩展](../../packages/cinnamon/README.zh-CN.md)
- [基础配置](./configuration.md)

English | [简体中文](./zh-CN/hooks.md)

# Hooks and custom consumers

Hooks publish Voice Brief lifecycle events to desktop UIs, logging tools, and other local integrations. They are notifications: consumers do not control TTS, alignment, queueing, or playback.

## Configure a transport

Unix sockets are intended for persistent local consumers such as the Cinnamon extension:

```yaml
hooks:
  - id: cinnamon
    transport: unix
    socket: /run/user/1000/voice-brief/cinnamon.sock
    timeoutMs: 1000
```

The socket path must be absolute. On Linux, prefer `$XDG_RUNTIME_DIR/voice-brief/<consumer>.sock` and write its expanded absolute path in YAML.

The stdin transport starts a command for each event and writes one newline-delimited JSON object to its standard input:

```yaml
hooks:
  - id: event-log
    transport: stdin
    command: /usr/local/bin/voice-brief-event-log
    args: [--format, json]
    timeoutMs: 1000
```

Hooks are delivered concurrently. A connection, process, or timeout failure is isolated to that hook and does not turn successful synthesis or playback into a failure. Hooks are not a durable message queue and missed events are not replayed.

## Event lifecycle

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

`brief.skipped` reports disabled, empty, duplicate, or throttled requests. `playback.skipped` reports an admitted briefing that cannot be played, for example when the player is disabled. Alignment is included in `playback.ready` when already available; otherwise the active briefing may receive one later `audio.alignment.ready` event.

## Envelope and context

The current protocol identifier is `voice-brief.hook-event`, version `2`.

| Field | Meaning |
| --- | --- |
| `eventId` | Unique ID for this event. |
| `occurredAt` | ISO timestamp created by Voice Brief. |
| `briefId` | Stable ID shared by events for one briefing. |
| `sequence` | Increasing event order within that briefing. |
| `event` | Lifecycle event name. |
| `brief` | Text, `final`/`progress`/`test` kind, and priority. |
| `source` | Optional agent, model, and session identifiers. |
| `persona` | Optional name, avatar path, and accent color. |
| `audio` | Optional provider, cache/provider source, duration, and alignment. |
| `reason` / `error` | Skip reason or stage-specific failure details. |

```json
{
  "protocol": "voice-brief.hook-event",
  "version": 2,
  "eventId": "event-uuid",
  "occurredAt": "2026-09-03T14:00:00.000Z",
  "briefId": "brief-uuid",
  "sequence": 4,
  "event": "playback.ready",
  "brief": { "text": "Tests passed.", "kind": "final", "priority": "normal" },
  "source": { "agent": "codex", "session": "Documentation" },
  "persona": { "name": "Project Assistant", "color": "#EB4272" },
  "audio": { "provider": "audiocpp", "source": "provider", "durationMs": 1840 }
}
```

## Consumer rules

- Group state by `briefId`; do not use `eventId` as the briefing identity.
- Apply events in `sequence` order and ignore stale updates.
- Treat `source`, `persona`, `audio`, duration, and alignment as optional.
- Ignore unknown optional fields and event names so additive changes do not break playback.
- Rebuild visible state from current events; do not wait for historical replay.
- Only apply late alignment when its `briefId` matches the current briefing.

The stdin command receives one NDJSON event per invocation. Long-lived UIs should prefer a Unix socket server and validate every event before changing UI state. The Cinnamon extension is the reference consumer for queue activation, late alignment, and terminal playback events.

## Related guides

- [Word alignment](./alignment.md)
- [Cinnamon extension](../packages/cinnamon/README.md)
- [Configuration](./configuration.md)

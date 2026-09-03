English | [简体中文](./zh-CN/configuration.md)

# Configuration

Voice Brief stores global runtime settings in YAML and personas in separate Markdown files. Run `voice-brief init` once to create both with built-in defaults.

## Find the active files

Do not assume a fixed home directory. Ask the current process which paths it uses:

```bash
voice-brief status --json
```

The result includes `configFile`, `personaDir`, `stateFile`, `cacheDir`, and `tempDir`. On Linux, the config directory is normally `~/.config/voice-brief`.

Override all Voice Brief paths with `VOICE_BRIEF_HOME`, or override individual locations with `VOICE_BRIEF_CONFIG_DIR`, `VOICE_BRIEF_STATE_DIR`, `VOICE_BRIEF_CACHE_DIR`, and `VOICE_BRIEF_TEMP_DIR`.

## Minimal configuration

This setup uses the key-free Edge provider and disables optional integrations:

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

Missing sections and fields are merged with built-in defaults. Unknown fields and invalid values are rejected instead of being silently ignored.

## Top-level sections

| Field | Purpose |
| --- | --- |
| `enabled` | Global switch, also controlled by `voice-brief on` and `voice-brief off`. |
| `provider` | Default TTS provider. |
| `fallbackProvider` | Provider used when the primary provider fails or is busy. |
| `providers` | Provider endpoints, models, credentials, concurrency, and audio options. |
| `alignment` | Optional word alignment, independent from TTS. |
| `hooks` | Lifecycle event consumers. |
| `playback` | Player selection, UI start delay, and Linux ducking. |
| `cache` | Synthesized audio cache limits and expiration. |
| `throttle` | Duplicate and progress-briefing limits. |

Provider and persona fields are documented in [TTS and personas](./tts-and-personas.md). See [Hooks](./hooks.md) and [word alignment](./alignment.md) for those optional integrations.

## Playback

`playback.command` defaults to `auto`, which selects an installed player. Set it to `none` to keep synthesis and hooks active without playing audio. `VOICE_BRIEF_PLAYER_COMMAND` overrides the configured command for the current environment.

Some hook consumers need time to animate before audio starts. Configure that delay through the daemon so the persisted configuration and active process stay in sync:

```bash
voice-brief runtime configure --playback-start-delay-ms 800
```

The Cinnamon extension configures its required delay automatically when enabled.

## Cache and throttling

The audio cache is enabled by default. `ttlMs` controls expiration, `maxEntries` limits retained entries, and `pruneIntervalMs` controls cleanup frequency. Cache keys include the text and effective provider settings, so changing a voice or model does not reuse incompatible audio.

Progress briefings are rate-limited. `progressIntervalMs` applies to normal progress updates, `highPriorityIntervalMs` applies to high-priority updates, and duplicate text can be skipped. Final briefings are handled separately.

## Validate changes

```bash
voice-brief status
voice-brief doctor
voice-brief provider list
voice-brief speak "Configuration check complete."
```

`doctor` reports the player, Linux ducking support, every TTS provider, and the most recent background playback error.

## Related guides

- [TTS and personas](./tts-and-personas.md)
- [Hooks and custom consumers](./hooks.md)
- [Linux audio ducking](./linux-ducking.md)

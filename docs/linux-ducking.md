English | [简体中文](./zh-CN/linux-ducking.md)

# Linux audio ducking

On Linux, Voice Brief can temporarily lower other active application streams while a briefing plays, then restore them smoothly. Ducking is optional and is not used on other platforms.

## Requirements

- `pactl` must be installed.
- A reachable PulseAudio server or PipeWire-Pulse compatibility service must be running.
- Applications must expose active sink-input streams to that service.

Check support with:

```bash
voice-brief doctor
```

If ducking is unavailable, Voice Brief still plays normally without lowering other applications.

## Configuration

```yaml
playback:
  ducking:
    enabled: true
    attenuationDb: 24
    restoreFadeMs: 700
```

| Field | Meaning |
| --- | --- |
| `enabled` | Enables Linux ducking. |
| `attenuationDb` | How strongly other active streams are reduced. A larger value is quieter. |
| `restoreFadeMs` | Duration of the smooth return to each original volume. Use `0` for immediate restoration. |

To disable the feature without changing playback:

```yaml
playback:
  ducking:
    enabled: false
```

## What Voice Brief changes

At playback time, Voice Brief records the current per-channel volume of active, non-corked sink inputs, excludes its own playback stream, lowers the remaining streams, and restores the exact recorded values after playback. Applications that start later are not blindly assigned a guessed volume.

A session journal in the Voice Brief state directory records pending restoration. If a previous daemon stopped unexpectedly, a later ducking session attempts to repair streams that still match the volume Voice Brief set. It avoids overwriting a volume that the user or another application changed in the meantime.

## Cinnamon smoke tests

Cinnamon karaoke smoke tests launch their fixture player directly and mark it as `voice-brief-cinnamon-smoke`. The ducking service excludes that stream, and the smoke path does not run through Voice Brief playback. This prevents presentation tests from changing remembered application volumes.

## Troubleshooting

1. Run `voice-brief doctor` and confirm that ducking is reported as available.
2. Confirm the affected application is visible as an active sink input while audio is playing.
3. Check `playback.ducking` in the config file reported by `voice-brief status --json`.
4. If an application was restarted during a briefing, let a later Voice Brief playback perform journal recovery before manually changing persisted audio rules.
5. Disable ducking while diagnosing player or PipeWire/PulseAudio issues; TTS and playback do not depend on it.

Do not use visual or alignment smoke tests as a substitute for a real ducking test. They deliberately bypass this feature.

## Related guides

- [Configuration](./configuration.md)
- [Cinnamon extension](../packages/cinnamon/README.md)

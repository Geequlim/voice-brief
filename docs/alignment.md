English | [简体中文](./zh-CN/alignment.md)

# Word alignment

Word alignment is an optional capability layered on top of synthesized audio. It supplies character ranges and timestamps for karaoke-style highlighting, but it is not part of TTS and never gates playback.

## Runtime behavior

Once TTS produces an audio file, Voice Brief immediately makes it eligible for playback and starts alignment alongside the remaining preparation work.

```text
TTS completes
├── audio enters the playback queue
└── alignment starts
      ├── ready early → included in playback.ready
      ├── ready while active → audio.alignment.ready
      └── fails or times out → playback continues without highlighting
```

Queued items keep an early alignment result until they become active. A late result is emitted only for the briefing currently preparing to play or already playing. Consumers that do not support alignment can ignore it completely.

## Configure audio.cpp alignment

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

| Field | Meaning |
| --- | --- |
| `enabled` | Enables alignment requests. It does not affect whether TTS plays. |
| `provider` | Alignment provider ID; currently `audiocpp`. |
| `baseUrl` | audio.cpp API base URL. |
| `model` | Alignment model ID sent with the request. |
| `language` | Optional language hint. |
| `timeoutMs` | Model lookup, loading, and alignment request timeout. |
| `apiKeyEnv` | Optional environment variable containing the service API key. |
| `family` / `modelPath` | Optional explicit model source used instead of catalog discovery. |

Alignment has its own endpoint and model settings. It does not inherit the TTS provider merely because both services use audio.cpp.

## Model discovery and loading

Voice Brief checks the audio.cpp model list before alignment. If the configured model is already loaded, alignment starts immediately. Otherwise:

1. Explicit `family` and `modelPath` are used when both are configured.
2. Missing model-source details are discovered from the audio.cpp model catalog.
3. Voice Brief requests `/models/load` with the `align` task before uploading audio.

This lets a restarted audio.cpp service recover automatically. If the service cannot discover or load the model, only alignment is lost; TTS and playback continue.

## Audio preparation

audio.cpp alignment expects 16 kHz, mono, signed 16-bit PCM WAV input. A TTS result already matching that format is uploaded directly. Other WAV parameters and compressed formats are converted with `ffmpeg` into a temporary alignment file. The original playback audio is not replaced.

Install `ffmpeg` on the Voice Brief machine if the selected TTS output does not already meet the alignment requirements.

## Hook delivery

An early result is attached to `playback.ready.audio.alignment`. A late result uses `audio.alignment.ready` and contains the same audio metadata plus the alignment:

```json
{
  "source": "audiocpp:qwen3-align",
  "cues": [
    { "text": "Tests", "startMs": 0, "endMs": 310, "startChar": 0, "endChar": 5 }
  ]
}
```

Consumers must match `briefId`, respect character ranges, and catch up from current playback time when alignment arrives late. See [Hooks and custom consumers](./hooks.md) for the complete event contract.

## Verify without changing system volume

With audio.cpp running, the repository alignment smoke test uploads the fixture and validates its result:

```bash
yarn tiny develop/alignment-smoke
```

It does not start a player and does not invoke Voice Brief audio ducking.

For the Cinnamon presentation layer, `develop/cinnamon/smoke/karaoke` tests alignment available at playback readiness, while `develop/cinnamon/smoke/karaoke-late` tests a result arriving during playback. Those fixtures launch their own player and bypass runtime ducking.

## Troubleshooting

- Confirm `alignment.enabled` and the alignment model ID in `voice-brief status --json`.
- Query the audio.cpp model list and verify the configured model can be loaded as an alignment task.
- Install `ffmpeg` if logs report that audio preparation failed.
- If highlighting runs too fast or slowly, verify the uploaded alignment WAV is actually 16 kHz mono PCM.
- Treat missing highlighting as an alignment problem only when the underlying speech still plays.

## Related guides

- [Hooks and custom consumers](./hooks.md)
- [TTS and personas](./tts-and-personas.md)
- [Cinnamon extension](../packages/cinnamon/README.md)

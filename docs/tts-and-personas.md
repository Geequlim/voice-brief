English | [简体中文](./zh-CN/tts-and-personas.md)

# TTS and personas

Global configuration describes how Voice Brief reaches a TTS service. A persona selects a provider and customizes its voice, visual identity, and briefing style for a particular agent installation or `speak` call.

## Provider selection and fallback

Voice Brief uses the persona's `provider` when present, otherwise the global `provider`. It follows the same rule for `fallbackProvider`. Provider-specific persona fields override the corresponding global provider fields one by one.

```yaml
provider: fish
fallbackProvider: edge
providers:
  fish:
    apiKeyEnv: FISH_API_KEY
    model: s2-pro
    format: mp3
  edge:
    voice: en-US-AvaMultilingualNeural
    rate: +0%
```

Keep credentials in environment variables. `apiKeyEnv` contains the variable name, not the secret itself.

## Providers

| Provider | Typical use | Important fields |
| --- | --- | --- |
| `edge` | Key-free setup and fallback | `voice`, `rate`, `volume` |
| `fish` | Fish Audio cloud voices and references | `apiKeyEnv`, `model`, `referenceId`, `format`, `volume` |
| `openai` | OpenAI-compatible speech endpoints | `apiKeyEnv`, `baseUrl`, `model`, `voice`, `format`, `volume` |
| `audiocpp` | Local or self-hosted audio.cpp | `baseUrl`, `model`, `voice`, `voiceRef`, `referenceText`, `seed`, `volume` |
| `mock` | Tests without audio output | `outputText` |

`concurrency` is a global provider setting. When its limit is reached, Voice Brief may use the fallback provider. Persona provider blocks do not change concurrency.

### audio.cpp model loading

For a configured model ID, Voice Brief first checks `/models`. If the model is not loaded, it can discover its family and path from the audio.cpp model catalog and load it automatically. Explicit `family` and `modelPath` values take priority over catalog discovery.

`voiceRef` may be a service-side reference or a local WAV/MP3 file. Relative local paths are resolved from the persona directory. Local MP3 references are converted to WAV and normalized before upload.

## Persona files

Personas live in the directory reported as `personaDir` by `voice-brief status --json`. The filename without `.md` is the persona name used by the CLI.

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
  voice: en-US-AvaMultilingualNeural
  rate: +4%
---

# Project Assistant

Use short, calm voice briefings. Lead with the result, then mention any blocker or next action.
```

| Field | Meaning |
| --- | --- |
| `provider` / `fallbackProvider` | Persona-specific provider routing. |
| `avatar` | Image path exposed to hook consumers such as Cinnamon. |
| `color` | Accent color exposed to hook consumers. |
| `edge`, `fish`, `openai`, `audiocpp` | Per-provider overrides for this persona. |

The Markdown body is installed into the target agent as writing guidance for voice briefings. It must not change how the agent reasons, edits code, or writes its normal text response.

## Manage and test personas

```bash
voice-brief persona list
voice-brief persona show "Project Assistant"
voice-brief speak "This is a persona preview." -p "Project Assistant"
```

Install the persona after previewing the generated changes:

```bash
voice-brief install "Project Assistant" codex --dry-run
voice-brief install "Project Assistant" codex
```

Re-run `install` after changing the persona body so the agent instructions are updated. Runtime front matter is read whenever the persona is loaded.

## Troubleshooting

- Run `voice-brief doctor` to check endpoints, API-key environment variables, and the player.
- Run `voice-brief status --json` to confirm which config and persona directories are active.
- Test a fallback independently with a persona that selects it as the primary provider.
- If audio is unexpectedly quiet, check both the effective `volume` and the source reference audio.

## Related guides

- [Configuration](./configuration.md)
- [Word alignment](./alignment.md)
- [Cinnamon extension](../packages/cinnamon/README.md)

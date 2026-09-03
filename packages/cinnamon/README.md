English | [简体中文](https://github.com/Geequlim/voice-brief/blob/main/packages/cinnamon/README.zh-CN.md)

# Cinnamon extension

The official Voice Brief hook consumer for the Cinnamon desktop. While Voice Brief speaks, the extension shows a dialogue card on the primary monitor with the persona name, avatar, and accent color, and highlights words in sync with the audio (karaoke subtitles) when [word alignment](https://github.com/Geequlim/voice-brief/blob/main/docs/alignment.md) is enabled.

Extension UUID: `voice-brief@tinyaxis`. Requires Cinnamon 6.6 on Linux.

## Install

The npm package ships the built extension and installs it as a postinstall step:

```bash
npm install -g @tinyaxis/voice-brief-cinnamon
```

This copies the extension to `~/.local/share/cinnamon/extensions/voice-brief@tinyaxis` (honors `XDG_DATA_HOME`). The install is atomic, keeps a backup until it succeeds, and never enables or reloads the extension by itself.

Enable it in **System Settings → Extensions → Voice Brief**.

## Connect Voice Brief

The extension listens on a Unix socket from the moment it is enabled:

```text
$XDG_RUNTIME_DIR/voice-brief/cinnamon.sock
```

On a typical session this resolves to `/run/user/1000/voice-brief/cinnamon.sock`, and the socket directory is created with owner-only permissions. Register the same path as a hook in the Voice Brief configuration (run `voice-brief status --json` to find the active config file):

```yaml
hooks:
  - id: cinnamon
    transport: unix
    socket: /run/user/1000/voice-brief/cinnamon.sock
    timeoutMs: 1000
```

Then verify with a test briefing:

```bash
voice-brief speak "Cinnamon overlay check."
```

Every event is validated (protocol version, event name, field types) before it reaches the UI; malformed events are dropped and logged without affecting other hooks or playback. The complete event contract is documented in [Hooks and custom consumers](https://github.com/Geequlim/voice-brief/blob/main/docs/hooks.md).

## Display settings

Open the extension settings from **System Settings → Extensions → Voice Brief** (the dialog labels are localized in Chinese):

| Setting | Options | Default |
| --- | --- | --- |
| Screen position (屏幕位置) | `top` (靠顶部), `bottom` (靠底部) | `top` |
| Screen margin (屏幕边距) | 0–512 px, 8 px steps | `112` |

The dialogue is placed on the primary monitor only and stays visible in fullscreen. Position changes apply to the currently visible dialogue immediately.

## Persona appearance

Name, avatar, and accent color come from the active persona front matter — the same fields documented in [TTS and personas](https://github.com/Geequlim/voice-brief/blob/main/docs/tts-and-personas.md):

- `name` — card title; falls back to `Voice Brief`.
- `avatar` — path to a local image file. When missing or unreadable, the avatar is omitted and the text card fades in directly.
- `color` — six-digit hex color used for the border, the name, and the karaoke highlight; falls back to `#eb4272`.

The context line under the title shows the session name when available, otherwise `agent · model`, and is hidden when neither is present.

## Dialogue behavior

- A new briefing plays a short entrance animation: the avatar pops in, then the dialogue expands and settles.
- A queued follow-up keeps the panel visible and replaces the content in place with a single emphasis animation.
- Press `Esc` or the on-card hide button to dismiss the current briefing. Later events for a dismissed briefing are ignored until it finishes.
- Terminal events (`playback.completed`, `playback.failed`, `playback.skipped`, `audio.failed`) hide the card, unless another briefing is already queued.

## Karaoke subtitles

When word alignment is available, spoken words are highlighted in sync with playback: upcoming text is gray, the current word is bold and blends toward the accent color, and spoken words keep a lighter accent tint. Highlighting starts with `playback.started` and refreshes about 30 times per second.

- Alignment arriving after playback started (`audio.alignment.ready`) is applied immediately and catches up to the current playback position.
- Without alignment, or when cues do not exactly match the briefing text, the card renders plain static text. Missing highlighting never affects audio.

## Playback start delay

The entrance animation takes about 1.2 seconds. So speech does not start before the dialogue is fully visible, enabling the extension runs:

```bash
voice-brief runtime configure --playback-start-delay-ms 1150
```

This writes the shared `playback.startDelayMs` setting documented in [Configuration](https://github.com/Geequlim/voice-brief/blob/main/docs/configuration.md). If the `voice-brief` executable is not on `PATH` at that moment, the step is skipped with a log entry; the overlay still works, but speech may start during the animation. Toggle the extension off and on after installing the CLI to apply the delay.

## Update and uninstall

Update to a new version:

```bash
npm install -g @tinyaxis/voice-brief-cinnamon
```

The postinstall script replaces the extension files. Reload the extension afterwards — toggle it in System Settings, or run:

```bash
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon \
  --method org.Cinnamon.ReloadXlet voice-brief@tinyaxis EXTENSION
```

Uninstalling the npm package does not remove the installed extension. To remove everything:

1. Disable the extension in System Settings.
2. Delete `~/.local/share/cinnamon/extensions/voice-brief@tinyaxis`.
3. Remove the `hooks` entry from the Voice Brief configuration and reset the delay with `voice-brief runtime configure --playback-start-delay-ms 0`.

## Troubleshooting

- **No dialogue appears.** Confirm the extension is enabled, the socket file exists (`ls "$XDG_RUNTIME_DIR/voice-brief/cinnamon.sock"`), and the `hooks` entry in the Voice Brief configuration points to the same path. Then send a test briefing.
- **A log entry says the playback start delay was not configured.** `voice-brief` was not on `PATH` when the extension started. Install the CLI, then toggle the extension off and on.
- **Speech plays but text stays static.** Alignment is unavailable or misconfigured; the overlay intentionally falls back to plain text. See [Word alignment](https://github.com/Geequlim/voice-brief/blob/main/docs/alignment.md).
- **Events are rejected in the log.** The event failed validation and was dropped; other hooks and audio playback are not affected.

## Development

From a repository checkout:

| Command | Purpose |
| --- | --- |
| `yarn tiny develop/cinnamon` | Build, install, and reload the extension in one step |
| `yarn tiny develop/cinnamon/install` | Build and install without reloading |
| `yarn tiny develop/cinnamon/smoke [scenario]` | Visual smoke scenarios (see below) |
| `yarn tiny test/cinnamon` | GJS unit tests for the extension |

Source layout: `src/extension.ts` (lifecycle and settings), `src/dialogue-overlay.ts` (dialogue UI and event handling), `src/lib/protocol.ts` (event validation), `src/lib/hook-server.ts` (Unix socket server), `assets/` (metadata, settings schema, stylesheet).

Smoke scenarios: `entrance`, `dialogue`, `multiline`, `no-session`, `queue`, `karaoke`, `karaoke-late`, or `all` (everything except the karaoke fixtures). They connect directly to the running extension's socket, so the extension must be enabled, and they do not involve the daemon. Set `VOICE_BRIEF_SMOKE_PERSONA` to use a different persona file and `VOICE_BRIEF_CINNAMON_SOCKET` to target a non-default socket. The `karaoke` scenarios play a fixture audio file through `mpv` (override with `VOICE_BRIEF_KARAOKE_PLAYER`); that player identifies itself as `voice-brief-cinnamon-smoke` and is excluded from [audio ducking](https://github.com/Geequlim/voice-brief/blob/main/docs/linux-ducking.md), so smoke runs never lower other applications' volume.

## Related documentation

- [Hooks and custom consumers](https://github.com/Geequlim/voice-brief/blob/main/docs/hooks.md)
- [Word alignment](https://github.com/Geequlim/voice-brief/blob/main/docs/alignment.md)
- [TTS and personas](https://github.com/Geequlim/voice-brief/blob/main/docs/tts-and-personas.md)
- [Linux audio ducking](https://github.com/Geequlim/voice-brief/blob/main/docs/linux-ducking.md)
- [Configuration](https://github.com/Geequlim/voice-brief/blob/main/docs/configuration.md)

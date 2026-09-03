English | [简体中文](https://github.com/Geequlim/voice-brief/blob/main/README.zh-CN.md)

# Voice Brief

Voice Brief turns coding-agent updates into short local voice briefings, so you can follow long-running work without watching the screen. It includes multiple TTS providers, personas, a persistent playback daemon, Linux audio ducking, lifecycle hooks, optional word alignment, and a Cinnamon desktop overlay.

## Demo

[Watch the demo video](https://github.com/user-attachments/assets/f0ca86ee-7a6e-424e-a659-20895fc2b714)

## Install

Voice Brief requires Node.js 24 or newer.

```bash
npm install -g @tinyaxis/voice-brief
voice-brief init
voice-brief doctor
```

Speak a briefing:

```bash
voice-brief speak "The task is complete and all tests passed."
```

Enable or disable all briefings:

```bash
voice-brief on
voice-brief off
voice-brief toggle
```

## Documentation

| Goal | Guide |
| --- | --- |
| Understand config files, defaults, playback, and cache | [Configuration](https://github.com/Geequlim/voice-brief/blob/main/docs/configuration.md) |
| Choose a TTS provider or create a persona | [TTS and personas](https://github.com/Geequlim/voice-brief/blob/main/docs/tts-and-personas.md) |
| Connect a UI or another event consumer | [Hooks and custom consumers](https://github.com/Geequlim/voice-brief/blob/main/docs/hooks.md) |
| Add karaoke-style word highlighting | [Word alignment](https://github.com/Geequlim/voice-brief/blob/main/docs/alignment.md) |
| Lower other applications while Voice Brief speaks | [Linux audio ducking](https://github.com/Geequlim/voice-brief/blob/main/docs/linux-ducking.md) |
| Show briefings on the Cinnamon desktop | [Cinnamon extension](https://github.com/Geequlim/voice-brief/blob/main/packages/cinnamon/README.md) |

## Features

- One-command final and progress briefings.
- audio.cpp, Fish Audio, OpenAI, Edge TTS, and mock providers with fallback support.
- Markdown personas that control voice settings, avatar, color, and briefing style.
- A persistent daemon for synthesis, playback queues, throttling, and cache management.
- Unix socket and stdin hooks for desktop UIs and custom integrations.
- Optional word alignment that never blocks TTS or playback.
- Linux PulseAudio/PipeWire audio ducking with crash recovery.
- Agent integrations for Codex, Claude, OpenCode, Copilot, Pi, Kimi Code, and ZCode.

## Agent integration

Install a persona's briefing instructions and the Voice Brief skill into an agent:

```bash
voice-brief persona list
voice-brief install "默认中文助理" codex --dry-run
voice-brief install "默认中文助理" codex
```

Supported targets are `codex`, `claude`, `opencode`, `copilot`, `pi`, `kimi-code`, and `zcode`.

## Development

```bash
yarn install
yarn tiny list
yarn tiny lint
yarn tiny test
yarn tiny compile
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the complete development and compatibility guidelines.

## License

[MIT](./LICENSE) © Geequlim

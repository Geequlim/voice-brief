# Voice Brief Cinnamon

Voice Brief 的 Cinnamon 桌面扩展子包。源码使用 TypeScript 编写，由 `tsc` 编译为 Cinnamon 可加载的 GJS JavaScript；扩展运行时不依赖 Node.js。

扩展启用后监听 `$XDG_RUNTIME_DIR/voice-brief/cinnamon.sock`，接收一行 NDJSON 格式的 Voice Brief Hook 事件。Hook Server 启动后，扩展通过 `voice-brief runtime configure` 按自身动画常量设置播放启动延迟；收到单向的 `playback.ready` 时在主显示器依次执行头像与完整对话入场动画。合成和排队事件不会产生可见中间态，播放结束、失败或跳过时关闭。

## 开发

- `src/extension.ts`：扩展生命周期入口。
- `src/dialogue-overlay.ts`：桌面对话展示与事件生命周期。
- `src/lib/protocol.ts`：Hook 协议输入校验。
- `src/lib/hook-server.ts`：Gio Unix Socket 服务。
- `assets/`：Cinnamon 扩展元数据和样式。
- `dist/voice-brief@tinyaxis/`：生成的可安装扩展目录，不提交到仓库。

构建扩展：

```bash
yarn workspace @tinyaxis/voice-brief-cinnamon build
```

构建、安装到当前用户并让 Cinnamon 重载扩展：

```bash
yarn tiny develop/cinnamon
```

### 视觉冒烟测试

扩展安装并启用后，可以直接向 Hook Socket 注入测试事件，不会请求 TTS 或播放语音：

```bash
yarn tiny develop/cinnamon/smoke
yarn tiny develop/cinnamon/smoke/entrance
yarn tiny develop/cinnamon/smoke/dialogue
yarn tiny develop/cinnamon/smoke/multiline
yarn tiny develop/cinnamon/smoke/no-session
yarn tiny develop/cinnamon/smoke/karaoke
yarn tiny develop/cinnamon/smoke/karaoke-late
```

默认读取 `~/.config/voice-brief/personas/甜妹助理.md`。可以通过 `VOICE_BRIEF_SMOKE_PERSONA` 指定其他人设文件，通过 `VOICE_BRIEF_CINNAMON_SOCKET` 指定其他 Socket。

`karaoke` 会在播放就绪时带上时间轴；`karaoke-late` 会在播放 2.5 秒后补发时间轴，用于确认前端直接追赶当前进度。两者都直接启动 `mpv` 播放仓库暂存的 MP3，不经过 Voice Brief runtime，因此不会触发全局音频压低。默认使用 `mpv`；如有需要，可通过 `VOICE_BRIEF_KARAOKE_PLAYER` 指定兼容的播放器命令。

## 测试

```bash
yarn workspace @tinyaxis/voice-brief-cinnamon test
```

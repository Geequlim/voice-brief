import { EventEmitter } from 'node:events';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { VoiceBriefConfig } from '../src/config/schema';
import type { VoiceBriefPaths } from '../src/config/types';

const createPlayerMock = vi.hoisted(() => vi.fn());

vi.mock('play-sound', () => ({
	default: createPlayerMock,
}));

import type { VoiceBriefRuntimeModule } from '../src/runtime';
import { VoiceBriefPlaybackService, VoiceBriefPlaybackStoppedError } from '../src/runtime/services/playback-service';

interface MockChildProcess extends EventEmitter {
	kill: ReturnType<typeof vi.fn>;
}

const createConfig = (): VoiceBriefConfig => ({
	version: 1,
	enabled: true,
	provider: 'edge',
	hooks: [],
	providers: {},
	playback: {
		command: 'mock-player',
		startDelayMs: 0,
		ducking: {
			enabled: false,
			attenuationDb: 18,
			restoreFadeMs: 700,
		},
	},
	cache: {
		enabled: true,
		ttlMs: 60000,
		maxEntries: 100,
		pruneIntervalMs: 30000,
	},
	throttle: {
		progressIntervalMs: 30000,
		highPriorityIntervalMs: 5000,
		networkCheckTtlMs: 60000,
	},
});

const createPaths = (root = '/tmp/voice-brief-playback'): VoiceBriefPaths => ({
	configDir: root,
	configFile: path.join(root, 'config.json'),
	personaDir: path.join(root, 'personas'),
	stateDir: root,
	stateFile: path.join(root, 'state.json'),
	cacheDir: path.join(root, 'cache'),
	tempDir: path.join(root, 'temp'),
});

describe('VoiceBriefPlaybackService', () => {
	test('在 daemon 进程内直接等待播放器完成', async () => {
		let complete: ((error?: Error) => void) | undefined;
		const child = createChild();
		const play = vi.fn((_audioFile: string, _options: unknown, callback: (error?: Error) => void) => {
			complete = callback;
			queueMicrotask(() => child.emit('spawn'));
			return child;
		});
		createPlayerMock.mockReturnValue({ player: 'mock-player', play });
		const duckingService = {
			playWithDucking: vi.fn(async (_paths: VoiceBriefPaths, _config: VoiceBriefConfig, playback: () => Promise<void>) => playback()),
		};
		const service = new VoiceBriefPlaybackService({ duckingService } as unknown as VoiceBriefRuntimeModule);
		const onStarted = vi.fn().mockResolvedValue(undefined);

		const playback = service.playAudioFile(createPaths(), createConfig(), '/tmp/audio.mp3', undefined, onStarted);
		await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());
		expect(onStarted).toHaveBeenCalledOnce();
		complete?.();

		await expect(playback).resolves.toBeUndefined();
		expect(duckingService.playWithDucking).toHaveBeenCalledOnce();
	});

	test('stop 会终止当前播放器并等待 ducking 恢复', async () => {
		const child = createChild();
		const play = vi.fn((_audioFile: string, _options: unknown, _callback: (error?: Error) => void) => {
			queueMicrotask(() => child.emit('spawn'));
			return child;
		});
		createPlayerMock.mockReturnValue({ player: 'mock-player', play });
		let restored = false;
		const duckingService = {
			async playWithDucking(_paths: VoiceBriefPaths, _config: VoiceBriefConfig, playback: () => Promise<void>) {
				try {
					await playback();
				} finally {
					restored = true;
				}
			},
		};
		const service = new VoiceBriefPlaybackService({ duckingService } as unknown as VoiceBriefRuntimeModule);
		const playback = service.playAudioFile(createPaths(), createConfig(), '/tmp/audio.mp3', undefined, async () => undefined);
		await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());

		await service.stop();

		await expect(playback).rejects.toBeInstanceOf(VoiceBriefPlaybackStoppedError);
		expect(child.kill).toHaveBeenCalledOnce();
		expect(restored).toBe(true);
	});

	test('auto 播放器按音量系数注入播放器参数', async () => {
		const play = createCompletingPlayer('mpv');
		const service = createService();
		const config = createConfig();
		config.playback.command = 'auto';

		await service.playAudioFile(createPaths(), config, '/tmp/audio.wav', 1.4, async () => undefined);
		expect(play.mock.calls[0]?.[1]).toEqual({
			detached: false,
			mpv: ['--no-video', '--really-quiet', '--volume=140'],
		});

		await service.playAudioFile(createPaths(), config, '/tmp/audio.wav', undefined, async () => undefined);
		expect(play.mock.calls[1]?.[1]).toEqual({
			detached: false,
			mpv: ['--no-video', '--really-quiet'],
		});
	});

	test('ffplay 音量参数截断到 100', async () => {
		const play = createCompletingPlayer('ffplay');
		const service = createService();
		const config = createConfig();
		config.playback.command = 'auto';

		await service.playAudioFile(createPaths(), config, '/tmp/audio.wav', 1.5, async () => undefined);
		expect(play.mock.calls[0]?.[1]).toEqual({
			detached: false,
			ffplay: ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', '100'],
		});
	});

	test('自定义播放命令不注入音量参数', async () => {
		const play = createCompletingPlayer('mpv');
		const service = createService();

		await service.playAudioFile(createPaths(), createConfig(), '/tmp/audio.wav', 1.4, async () => undefined);
		expect(play.mock.calls[0]?.[1]).toEqual({
			detached: false,
			mpv: [],
		});
	});

	function createService() {
		const duckingService = {
			playWithDucking: vi.fn(async (_paths: VoiceBriefPaths, _config: VoiceBriefConfig, playback: () => Promise<void>) => playback()),
		};
		return new VoiceBriefPlaybackService({ duckingService } as unknown as VoiceBriefRuntimeModule);
	}

	function createCompletingPlayer(player: string) {
		const play = vi.fn((_audioFile: string, _options: unknown, callback: (error?: Error) => void) => {
			const child = createChild();
			queueMicrotask(() => child.emit('spawn'));
			queueMicrotask(() => callback());
			return child;
		});
		createPlayerMock.mockReturnValue({ player, play });
		return play;
	}

	function createChild() {
		const child = new EventEmitter() as MockChildProcess;
		child.kill = vi.fn().mockReturnValue(true);
		return child;
	}
});

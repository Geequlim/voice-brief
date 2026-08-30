import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const voiceBriefModules = vi.hoisted(() => ({
	VoiceBriefConfigModule: class VoiceBriefConfigModule {},
	VoiceBriefHookModule: class VoiceBriefHookModule {},
	VoiceBriefPersonaModule: class VoiceBriefPersonaModule {},
}));

vi.mock('../src/config', () => ({
	VoiceBriefConfigModule: voiceBriefModules.VoiceBriefConfigModule,
}));

vi.mock('../src/hook', () => ({
	VoiceBriefHookModule: voiceBriefModules.VoiceBriefHookModule,
}));

vi.mock('../src/persona', () => ({
	VoiceBriefPersonaModule: voiceBriefModules.VoiceBriefPersonaModule,
}));

import { VoiceBriefConfigModule } from '../src/config';
import type { VoiceBriefConfig, VoiceBriefState } from '../src/config/schema';
import { VoiceBriefHookModule } from '../src/hook';
import type { VoiceBriefHookEventInput } from '../src/hook/types';
import { VoiceBriefPersonaModule } from '../src/persona';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import type { PreparedAudioResult } from '../src/runtime/types';
import { VoiceBriefRuntimeService } from '../src/runtime/services/runtime-service';

function createConfig(): VoiceBriefConfig {
	return {
		version: 1,
		enabled: true,
		provider: 'mock',
		hooks: [{ id: 'receiver', transport: 'stdin', command: 'receiver' }],
		providers: {},
		playback: {
			command: 'mock-player',
			startDelayMs: 0,
			ducking: {
				enabled: false,
				attenuationDb: 18,
				restoreFadeMs: 0,
			},
		},
		cache: {
			enabled: false,
			ttlMs: 0,
			maxEntries: 0,
			pruneIntervalMs: 0,
		},
		throttle: {
			progressIntervalMs: 30_000,
			highPriorityIntervalMs: 5_000,
			networkCheckTtlMs: 60_000,
		},
	};
}

function createRuntime(options?: {
	isDisabled?: boolean;
	playAudioFile?: ReturnType<typeof vi.fn>;
	synthesize?: () => Promise<PreparedAudioResult>;
}) {
	const config = createConfig();
	const state: VoiceBriefState = {};
	const events: VoiceBriefHookEventInput[] = [];
	const configModule = {
		pathService: {
			resolveVoiceBriefPaths: async () => ({
				configDir: '/tmp/voice-brief',
				configFile: '/tmp/voice-brief/config.yaml',
				personaDir: '/tmp/voice-brief/personas',
				stateDir: '/tmp/voice-brief/state',
				stateFile: '/tmp/voice-brief/state/state.yaml',
				cacheDir: '/tmp/voice-brief/cache',
				tempDir: '/tmp/voice-brief/temp',
			}),
			ensureVoiceBriefDirs: vi.fn().mockResolvedValue(undefined),
		},
		configService: {
			ensure: async () => config,
		},
		stateService: {
			load: async () => state,
			update: async <T>(operation: (current: VoiceBriefState) => Promise<T> | T) => operation(state),
		},
	};
	const hookModule = {
		hookService: {
			dispatch: vi.fn(async (_hooks, event: VoiceBriefHookEventInput) => {
				events.push(event);
			}),
		},
	};
	const personaModule = {
		personaService: {
			load: async () => ({
				fileName: '角色.md',
				name: '角色',
				instructions: '角色提示词',
				avatar: 'assets/avatar.png',
				color: '#F59EAE',
			}),
		},
	};
	const synthesize = options?.synthesize || vi.fn().mockResolvedValue({
		audioFile: '/tmp/voice-brief/audio.mp3',
		provider: 'mock',
		source: 'provider',
	});
	const playAudioFile = options?.playAudioFile || vi.fn(async (_paths, _config, _audioFile, _volume, onStarted: () => Promise<void>) => {
		await onStarted();
	});
	const module = {
		app: {
			getModule(moduleType: unknown) {
				if (moduleType === VoiceBriefConfigModule) return configModule;
				if (moduleType === VoiceBriefHookModule) return hookModule;
				if (moduleType === VoiceBriefPersonaModule) return personaModule;
				throw new Error('未知测试模块');
			},
		},
		cacheService: {
			pruneIfNeeded: vi.fn().mockResolvedValue(undefined),
		},
		throttleService: {
			normalizeText: (text: string) => text.trim(),
			getProgressSkipResult: (): undefined => undefined,
			applyProgressState: vi.fn(),
			applyFinalState: vi.fn(),
		},
		providerService: {
			startSynthesisWithFallback: vi.fn(async () => ({
				provider: 'mock',
				source: 'provider',
				result: synthesize(),
			})),
		},
		audioMetadataService: {
			getAudioDurationMs: vi.fn().mockResolvedValue(4200),
		},
		playbackService: {
			isDisabled: () => options?.isDisabled ?? false,
			playAudioFile,
		},
	} as unknown as VoiceBriefRuntimeModule;

	return {
		config,
		events,
		playAudioFile,
		service: new VoiceBriefRuntimeService(module),
		state,
		synthesize,
	};
}

describe('VoiceBrief Runtime Hook 事件', () => {
	test('事件按合成、就绪队列、展示和播放的真实状态发送', async () => {
		const runtime = createRuntime();
		const admission = await runtime.service.admitSpeech('brief-1', {
			kind: 'final',
			text: '任务完成',
			options: {
				agent: 'codex',
				model: 'gpt-5.6-sol',
				personaName: '角色',
				session: 'Hook 协议',
			},
		});
		if (admission.status !== 'admitted') throw new Error('测试预期任务通过准入');
		const start = await runtime.service.startSpeech(admission.speech, { personaName: '角色' });
		const prepared = await start.completion;
		if (!prepared) throw new Error('测试预期音频准备成功');

		expect(runtime.events.map(event => event.event)).toEqual(['audio.preparing', 'audio.ready']);
		await runtime.service.queueSpeech(prepared);
		await runtime.service.playSpeech(prepared);

		expect(runtime.events.map(event => event.event)).toEqual([
			'audio.preparing',
			'audio.ready',
			'playback.queued',
			'playback.ready',
			'playback.started',
			'playback.completed',
		]);
		expect(runtime.events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(runtime.events[0]).toMatchObject({
			briefId: 'brief-1',
			source: {
				agent: 'codex',
				model: 'gpt-5.6-sol',
				session: 'Hook 协议',
			},
			persona: {
				name: '角色',
				avatar: path.resolve('/tmp/voice-brief/personas/assets/avatar.png'),
				color: '#F59EAE',
			},
		});
	});

	test('provider 返回的 alignment 会完整传递给播放 Hook 事件', async () => {
		const alignment = {
			source: 'fixture',
			cues: [{ text: '任', startMs: 0, endMs: 120, startChar: 0, endChar: 1 }],
		};
		const runtime = createRuntime({
			synthesize: vi.fn().mockResolvedValue({
				audioFile: '/tmp/voice-brief/audio.mp3',
				provider: 'mock',
				source: 'provider',
				alignment,
			}),
		});
		const admission = await runtime.service.admitSpeech('brief-1', { kind: 'final', text: '任务完成' });
		if (admission.status !== 'admitted') throw new Error('测试预期任务通过准入');
		const start = await runtime.service.startSpeech(admission.speech);
		const prepared = await start.completion;
		if (!prepared) throw new Error('测试预期音频准备成功');
		await runtime.service.queueSpeech(prepared);
		await runtime.service.playSpeech(prepared);

		expect(runtime.events.filter(event => event.audio).every(event => event.audio?.alignment)).toBe(true);
		expect(runtime.events.find(event => event.event === 'playback.ready')?.audio?.alignment).toEqual(alignment);
	});

	test('合成失败只发送 audio.failed 并记录 provider 错误', async () => {
		const runtime = createRuntime({ synthesize: vi.fn().mockRejectedValue(new Error('synthesis failed')) });
		const admission = await runtime.service.admitSpeech('brief-1', { kind: 'final', text: '任务完成' });
		if (admission.status !== 'admitted') throw new Error('测试预期任务通过准入');

		const start = await runtime.service.startSpeech(admission.speech);
		await expect(start.completion).resolves.toBeUndefined();
		expect(runtime.events.map(event => event.event)).toEqual(['audio.preparing', 'audio.failed']);
		expect(runtime.events[1]).toMatchObject({
			error: { stage: 'synthesis', message: 'synthesis failed' },
		});
		expect(runtime.state.lastProviderError).toBe('synthesis failed');
	});

	test('播放失败发送 playback.failed 并继续由调度器处理后续任务', async () => {
		const runtime = createRuntime({ playAudioFile: vi.fn().mockRejectedValue(new Error('playback failed')) });
		const admission = await runtime.service.admitSpeech('brief-1', { kind: 'final', text: '任务完成' });
		if (admission.status !== 'admitted') throw new Error('测试预期任务通过准入');
		const start = await runtime.service.startSpeech(admission.speech);
		const prepared = await start.completion;
		if (!prepared) throw new Error('测试预期音频准备成功');

		await runtime.service.queueSpeech(prepared);
		await runtime.service.playSpeech(prepared);

		expect(runtime.events.map(event => event.event)).toEqual([
			'audio.preparing',
			'audio.ready',
			'playback.queued',
			'playback.ready',
			'playback.failed',
		]);
		expect(runtime.state.lastPlaybackError).toBe('playback failed');
	});

	test('播放器关闭时在队首发送 playback.skipped', async () => {
		const runtime = createRuntime({ isDisabled: true });
		const admission = await runtime.service.admitSpeech('brief-1', { kind: 'final', text: '任务完成' });
		if (admission.status !== 'admitted') throw new Error('测试预期任务通过准入');
		const start = await runtime.service.startSpeech(admission.speech);
		const prepared = await start.completion;
		if (!prepared) throw new Error('测试预期音频准备成功');

		await runtime.service.queueSpeech(prepared);
		await runtime.service.playSpeech(prepared);

		expect(runtime.events.map(event => event.event)).toEqual([
			'audio.preparing',
			'audio.ready',
			'playback.queued',
			'playback.skipped',
		]);
		expect(runtime.playAudioFile).not.toHaveBeenCalled();
	});

	test('playback.ready 后等待配置的启动延迟再启动播放器', async () => {
		vi.useFakeTimers();
		try {
			const runtime = createRuntime();
			runtime.config.playback.startDelayMs = 1500;
			const admission = await runtime.service.admitSpeech('brief-1', { kind: 'final', text: '任务完成' });
			if (admission.status !== 'admitted') throw new Error('测试预期任务通过准入');
			const start = await runtime.service.startSpeech(admission.speech);
			const prepared = await start.completion;
			if (!prepared) throw new Error('测试预期音频准备成功');
			await runtime.service.queueSpeech(prepared);

			const playback = runtime.service.playSpeech(prepared);
			await vi.waitFor(() => expect(runtime.events.at(-1)?.event).toBe('playback.ready'));
			expect(runtime.playAudioFile).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1499);
			expect(runtime.playAudioFile).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			await playback;
			expect(runtime.playAudioFile).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	test('daemon 停止时取消展示提前量且不再启动播放器', async () => {
		const runtime = createRuntime();
		runtime.config.playback.startDelayMs = 60_000;
		const admission = await runtime.service.admitSpeech('brief-1', { kind: 'final', text: '任务完成' });
		if (admission.status !== 'admitted') throw new Error('测试预期任务通过准入');
		const start = await runtime.service.startSpeech(admission.speech);
		const prepared = await start.completion;
		if (!prepared) throw new Error('测试预期音频准备成功');
		await runtime.service.queueSpeech(prepared);

		const playback = runtime.service.playSpeech(prepared);
		await vi.waitFor(() => expect(runtime.events.at(-1)?.event).toBe('playback.ready'));
		runtime.service.stop();
		await playback;

		expect(runtime.playAudioFile).not.toHaveBeenCalled();
	});
});

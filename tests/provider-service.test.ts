import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { VoiceBriefConfig, VoiceBriefState } from '../src/config/schema';
import type { VoiceBriefPaths } from '../src/config/types';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import { VoiceBriefCacheService } from '../src/runtime/services/cache-service';
import { VoiceBriefProviderBusyError, VoiceBriefProviderService } from '../src/runtime/services/provider-service';
import type { ProviderCacheDescriptor, ProviderCheckResult, SynthesizeInput, SynthesizeResult, TtsProvider } from '../src/runtime/types';

function createConfig(overrides?: Partial<VoiceBriefConfig>): VoiceBriefConfig {
	return {
		version: 1,
		enabled: true,
		provider: 'mock',
		hooks: [],
		providers: {},
		playback: {
			command: 'none',
			startDelayMs: 0,
			ducking: {
				enabled: true,
				attenuationDb: 18,
				restoreFadeMs: 700,
			},
		},
		cache: {
			enabled: true,
			ttlMs: 60_000,
			maxEntries: 10,
			pruneIntervalMs: 0,
		},
		throttle: {
			progressIntervalMs: 30_000,
			highPriorityIntervalMs: 5_000,
			networkCheckTtlMs: 60_000,
		},
		...overrides,
	};
}

async function createPaths(): Promise<VoiceBriefPaths> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-cache-'));
	return {
		configDir: root,
		configFile: path.join(root, 'config.yaml'),
		personaDir: path.join(root, 'personas'),
		stateDir: path.join(root, 'state'),
		stateFile: path.join(root, 'state.yaml'),
		cacheDir: path.join(root, 'cache'),
		tempDir: path.join(root, 'temp'),
	};
}

function createModule() {
	const module = {} as VoiceBriefRuntimeModule & { cacheService: VoiceBriefCacheService };
	module.cacheService = new VoiceBriefCacheService(module);
	return module;
}

function createProvider(id: string, options: {
	getCacheDescriptor(input: SynthesizeInput): ProviderCacheDescriptor;
	synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
}): TtsProvider {
	return {
		id,
		async check(): Promise<ProviderCheckResult> {
			return {
				ok: true,
				message: 'ok',
			};
		},
		getCacheDescriptor: options.getCacheDescriptor,
		synthesize: options.synthesize,
	};
}

describe('VoiceBriefProviderService cache', () => {
	test('相同文本和参数会复用缓存文件', async () => {
		const module = createModule();
		const service = new VoiceBriefProviderService(module);
		const paths = await createPaths();
		let synthesizeCount = 0;
		const provider = createProvider('mock', {
			getCacheDescriptor() {
				return {
					extension: 'mp3',
					keyData: {
						voice: 'A',
					},
				};
			},
			async synthesize(input) {
				synthesizeCount += 1;
				const audioFile = path.join(input.paths.tempDir, `audio-${synthesizeCount}.mp3`);
				await fs.mkdir(input.paths.tempDir, { recursive: true });
				await fs.writeFile(audioFile, `audio-${synthesizeCount}`, 'utf-8');
				return {
					audioFile,
					provider: 'mock',
				};
			},
		});
		vi.spyOn(service, 'getProvider').mockReturnValue(provider);

		const firstTask = await service.startSynthesisWithFallback(paths, createConfig(), undefined, 'final', '你好');
		const first = await firstTask.result;
		const secondTask = await service.startSynthesisWithFallback(paths, createConfig(), undefined, 'final', '你好');
		const second = await secondTask.result;

		expect(synthesizeCount).toBe(1);
		expect(firstTask.source).toBe('provider');
		expect(secondTask.source).toBe('cache');
		expect(first.audioFile).toBe(second.audioFile);
		expect(first.source).toBe('provider');
		expect(second.source).toBe('cache');
		await expect(fs.readFile(second.audioFile, 'utf-8')).resolves.toBe('audio-1');
	});

	test('影响声音的参数变化后会重新合成', async () => {
		const module = createModule();
		const service = new VoiceBriefProviderService(module);
		const paths = await createPaths();
		let synthesizeCount = 0;
		let voice = 'A';
		const provider = createProvider('mock', {
			getCacheDescriptor() {
				return {
					extension: 'mp3',
					keyData: {
						voice,
					},
				};
			},
			async synthesize(input) {
				synthesizeCount += 1;
				const audioFile = path.join(input.paths.tempDir, `audio-${synthesizeCount}.mp3`);
				await fs.mkdir(input.paths.tempDir, { recursive: true });
				await fs.writeFile(audioFile, `voice-${voice}`, 'utf-8');
				return {
					audioFile,
					provider: 'mock',
				};
			},
		});
		vi.spyOn(service, 'getProvider').mockReturnValue(provider);

		const first = await (await service.startSynthesisWithFallback(paths, createConfig(), undefined, 'final', '你好')).result;
		voice = 'B';
		const second = await (await service.startSynthesisWithFallback(paths, createConfig(), undefined, 'final', '你好')).result;

		expect(synthesizeCount).toBe(2);
		expect(first.audioFile).not.toBe(second.audioFile);
		await expect(fs.readFile(second.audioFile, 'utf-8')).resolves.toBe('voice-B');
	});

	test('缓存过期后会重新合成并覆盖旧文件', async () => {
		const module = createModule();
		const service = new VoiceBriefProviderService(module);
		const paths = await createPaths();
		let synthesizeCount = 0;
		const provider = createProvider('mock', {
			getCacheDescriptor() {
				return {
					extension: 'mp3',
					keyData: {
						voice: 'A',
					},
				};
			},
			async synthesize(input) {
				synthesizeCount += 1;
				const audioFile = path.join(input.paths.tempDir, `audio-${synthesizeCount}.mp3`);
				await fs.mkdir(input.paths.tempDir, { recursive: true });
				await fs.writeFile(audioFile, `audio-${synthesizeCount}`, 'utf-8');
				return {
					audioFile,
					provider: 'mock',
				};
			},
		});
		vi.spyOn(service, 'getProvider').mockReturnValue(provider);
		const config = createConfig({
			cache: {
				enabled: true,
				ttlMs: 1_000,
				maxEntries: 10,
				pruneIntervalMs: 0,
			},
		});

		const first = await (await service.startSynthesisWithFallback(paths, config, undefined, 'final', '你好')).result;
		const expiredAt = new Date(Date.now() - 5_000);
		await fs.utimes(first.audioFile, expiredAt, expiredAt);
		const second = await (await service.startSynthesisWithFallback(paths, config, undefined, 'final', '你好')).result;

		expect(synthesizeCount).toBe(2);
		expect(first.audioFile).toBe(second.audioFile);
		await expect(fs.readFile(second.audioFile, 'utf-8')).resolves.toBe('audio-2');
	});
});

describe('VoiceBriefProviderService provider 调度', () => {
	test('primary 达到并发上限时立即使用 fallback', async () => {
		const module = createModule();
		const service = new VoiceBriefProviderService(module);
		const paths = await createPaths();
		let releasePrimary: (() => void) | undefined;
		const primary = createProvider('mock', {
			getCacheDescriptor: () => ({ extension: 'mp3', keyData: { provider: 'primary' } }),
			synthesize: vi.fn(async () => {
				await new Promise<void>(resolve => { releasePrimary = resolve; });
				return { audioFile: '/tmp/primary.mp3', provider: 'mock' };
			}),
		});
		const fallback = createProvider('edge', {
			getCacheDescriptor: () => ({ extension: 'mp3', keyData: { provider: 'fallback' } }),
			synthesize: vi.fn(async () => {
				return { audioFile: '/tmp/fallback.mp3', provider: 'edge' };
			}),
		});
		vi.spyOn(service, 'getProvider').mockImplementation(id => id === 'mock' ? primary : fallback);
		const config = createConfig({
			cache: { enabled: false, ttlMs: 0, maxEntries: 0, pruneIntervalMs: 0 },
			providers: { mock: { concurrency: 1 } },
			fallbackProvider: 'edge',
		});

		const first = await service.startSynthesisWithFallback(paths, config, undefined, 'final', 'first');
		await vi.waitFor(() => expect(primary.synthesize).toHaveBeenCalledOnce());
		const second = await service.startSynthesisWithFallback(paths, config, undefined, 'final', 'second');
		expect(second).toMatchObject({ provider: 'edge', source: 'provider' });
		await expect(second.result).resolves.toMatchObject({ provider: 'edge' });
		expect(primary.synthesize).toHaveBeenCalledOnce();
		expect(fallback.synthesize).toHaveBeenCalledOnce();
		releasePrimary?.();
		await first.result;
	});

	test('primary 和 fallback 均达到并发上限时快速失败', async () => {
		const module = createModule();
		const service = new VoiceBriefProviderService(module);
		const paths = await createPaths();
		const releases: Array<() => void> = [];
		const createBusyProvider = (id: string) => createProvider(id, {
			getCacheDescriptor: () => ({ extension: 'mp3', keyData: { provider: id } }),
			synthesize: vi.fn(async () => {
				await new Promise<void>(resolve => releases.push(resolve));
				return { audioFile: `/tmp/${id}.mp3`, provider: id };
			}),
		});
		const primary = createBusyProvider('mock');
		const fallback = createBusyProvider('edge');
		vi.spyOn(service, 'getProvider').mockImplementation(id => id === 'mock' ? primary : fallback);
		const config = createConfig({
			cache: { enabled: false, ttlMs: 0, maxEntries: 0, pruneIntervalMs: 0 },
			providers: { mock: { concurrency: 1 }, edge: { concurrency: 1 } },
			fallbackProvider: 'edge',
		});
		const fallbackOnlyConfig = createConfig({
			cache: { enabled: false, ttlMs: 0, maxEntries: 0, pruneIntervalMs: 0 },
			provider: 'edge',
			providers: config.providers,
		});

		const primaryTask = await service.startSynthesisWithFallback(paths, config, undefined, 'final', 'primary');
		const fallbackTask = await service.startSynthesisWithFallback(paths, fallbackOnlyConfig, undefined, 'final', 'fallback');
		await vi.waitFor(() => {
			expect(primary.synthesize).toHaveBeenCalledOnce();
			expect(fallback.synthesize).toHaveBeenCalledOnce();
		});
		const overflow = service.startSynthesisWithFallback(paths, config, undefined, 'final', 'overflow');
		await expect(overflow).rejects.toBeInstanceOf(VoiceBriefProviderBusyError);
		await expect(overflow).rejects.toMatchObject({ providerId: 'edge' });
		expect(primary.synthesize).toHaveBeenCalledOnce();
		expect(fallback.synthesize).toHaveBeenCalledOnce();
		for (const release of releases) release();
		await Promise.all([primaryTask.result, fallbackTask.result]);
	});

	test('未配置 concurrency 时不强制串行', async () => {
		const module = createModule();
		const service = new VoiceBriefProviderService(module);
		const paths = await createPaths();
		const releases: Array<() => void> = [];
		const synthesize = vi.fn(async () => {
			await new Promise<void>(resolve => releases.push(resolve));
			return { audioFile: '/tmp/audio.mp3', provider: 'mock' };
		});
		vi.spyOn(service, 'getProvider').mockReturnValue(createProvider('mock', {
			getCacheDescriptor: () => ({ extension: 'mp3', keyData: {} }),
			synthesize,
		}));
		const config = createConfig({
			cache: { enabled: false, ttlMs: 0, maxEntries: 0, pruneIntervalMs: 0 },
		});

		const first = await service.startSynthesisWithFallback(paths, config, undefined, 'final', 'first');
		const second = await service.startSynthesisWithFallback(paths, config, undefined, 'final', 'second');
		await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));
		for (const release of releases) release();
		await Promise.all([first.result, second.result]);
	});

	test('primary 和 fallback 复用同一个 attempt 执行流程', async () => {
		const module = createModule();
		const service = new VoiceBriefProviderService(module);
		const paths = await createPaths();
		const primary = createProvider('mock', {
			getCacheDescriptor: () => ({ extension: 'mp3', keyData: { provider: 'primary' } }),
			synthesize: vi.fn().mockRejectedValue(new Error('primary failed')),
		});
		const fallback = createProvider('edge', {
			getCacheDescriptor: () => ({ extension: 'mp3', keyData: { provider: 'fallback' } }),
			synthesize: vi.fn().mockResolvedValue({ audioFile: '/tmp/fallback.mp3', provider: 'edge' }),
		});
		vi.spyOn(service, 'getProvider').mockImplementation(id => id === 'mock' ? primary : fallback);
		const config = createConfig({
			cache: { enabled: false, ttlMs: 0, maxEntries: 0, pruneIntervalMs: 0 },
			fallbackProvider: 'edge',
		});

		const task = await service.startSynthesisWithFallback(paths, config, undefined, 'final', 'text');
		expect(task).toMatchObject({ provider: 'mock', source: 'provider' });
		await expect(task.result).resolves.toMatchObject({
			provider: 'edge',
			source: 'provider',
		});
		expect(primary.synthesize).toHaveBeenCalledOnce();
		expect(fallback.synthesize).toHaveBeenCalledOnce();
	});
});

describe('VoiceBriefCacheService prune', () => {
	test('会按 mtime 清理过期文件和超量的旧文件', async () => {
		const module = createModule();
		const service = module.cacheService;
		const paths = await createPaths();
		const state: VoiceBriefState = {};
		const staleFile = path.join(paths.cacheDir, 'mock', 'stale.mp3');
		const oldFile = path.join(paths.cacheDir, 'mock', 'old.mp3');
		const freshFile = path.join(paths.cacheDir, 'edge', 'fresh.mp3');
		await fs.mkdir(path.dirname(staleFile), { recursive: true });
		await fs.mkdir(path.dirname(freshFile), { recursive: true });
		await fs.writeFile(staleFile, 'stale', 'utf-8');
		await fs.writeFile(oldFile, 'old', 'utf-8');
		await fs.writeFile(freshFile, 'fresh', 'utf-8');

		const staleAt = new Date(Date.now() - 10_000);
		const oldAt = new Date(Date.now() - 2_000);
		const freshAt = new Date(Date.now() - 500);
		await fs.utimes(staleFile, staleAt, staleAt);
		await fs.utimes(oldFile, oldAt, oldAt);
		await fs.utimes(freshFile, freshAt, freshAt);

		await service.pruneIfNeeded(paths, createConfig({
			cache: {
				enabled: true,
				ttlMs: 5_000,
				maxEntries: 1,
				pruneIntervalMs: 0,
			},
		}), state);

		await expect(fs.stat(staleFile)).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(fs.stat(oldFile)).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(fs.readFile(freshFile, 'utf-8')).resolves.toBe('fresh');
		expect(typeof state.lastCachePruneAt).toBe('number');
	});
});

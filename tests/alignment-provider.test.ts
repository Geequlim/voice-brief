import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { VoiceBriefConfig } from '../src/config/schema';
import type { VoiceBriefPaths } from '../src/config/types';
import { AudioCppAlignmentProvider } from '../src/runtime/alignment-providers/audiocpp-alignment-provider';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import { VoiceBriefCacheService } from '../src/runtime/services/cache-service';
import { VoiceBriefAlignmentService } from '../src/runtime/services/alignment-service';
import type { PreparedSpeechTask } from '../src/runtime/types';

const roots: string[] = [];

function createConfig(): VoiceBriefConfig {
	return {
		version: 1,
		enabled: true,
		provider: 'mock',
		alignment: {
			enabled: true,
			provider: 'audiocpp',
			audiocpp: { baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen3-align', language: 'zh', timeoutMs: 1000 },
		},
		hooks: [],
		providers: {},
		playback: { command: 'none', startDelayMs: 0, ducking: { enabled: false, attenuationDb: 18, restoreFadeMs: 0 } },
		cache: { enabled: false, ttlMs: 0, maxEntries: 0, pruneIntervalMs: 0 },
		throttle: { progressIntervalMs: 30000, highPriorityIntervalMs: 5000, networkCheckTtlMs: 60000 },
	};
}

async function createPaths(): Promise<VoiceBriefPaths> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-alignment-'));
	roots.push(root);
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

function wavBytes(options?: { bitsPerSample?: number; channels?: number; sampleRate?: number; }) {
	const bitsPerSample = options?.bitsPerSample ?? 16;
	const channels = options?.channels ?? 1;
	const sampleRate = options?.sampleRate ?? 16000;
	const bytes = Buffer.alloc(44);
	bytes.write('RIFF', 0, 'ascii');
	bytes.writeUInt32LE(36, 4);
	bytes.write('WAVE', 8, 'ascii');
	bytes.write('fmt ', 12, 'ascii');
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(channels, 22);
	bytes.writeUInt32LE(sampleRate, 24);
	bytes.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
	bytes.writeUInt16LE(channels * bitsPerSample / 8, 32);
	bytes.writeUInt16LE(bitsPerSample, 34);
	bytes.write('data', 36, 'ascii');
	bytes.writeUInt32LE(0, 40);
	return bytes;
}

function stubAlignmentResponse(onRequest?: (form: FormData) => void) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
		const form = init?.body as FormData;
		onRequest?.(form);
		return new Response(JSON.stringify({
			text: '任务',
			words: [
				{ word: '任', start: 0, end: 0.1 },
				{ word: '务', start: 0.1, end: 0.2 },
			],
		}), { status: 200, headers: { 'content-type': 'application/json' } });
	});
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('AudioCppAlignmentProvider', () => {
	test('16k 单声道 s16 PCM WAV 直接上传并跳过 ffmpeg', async () => {
		const paths = await createPaths();
		const audioFile = path.join(paths.configDir, 'audio.bin');
		await fs.writeFile(audioFile, wavBytes());
		const execute = vi.fn();
		stubAlignmentResponse(form => {
			const file = form.get('file');
			expect(file).toBeInstanceOf(File);
			expect((file as File).name).toBe('alignment.wav');
			expect(form.get('model')).toBe('qwen3-align');
			expect(form.get('text')).toBe('任务');
			expect(form.get('language')).toBe('zh');
		});

		const result = await new AudioCppAlignmentProvider(execute).align({ audioFile, config: createConfig(), paths, text: '任务' });

		expect(execute).not.toHaveBeenCalled();
		expect(result.cues.map(cue => cue.text)).toEqual(['任', '务']);
		expect(result.cues[1]).toMatchObject({ startChar: 1, endChar: 2, startMs: 100, endMs: 200 });
	});

	test('44.1k WAV 不符合对齐输入要求并执行转换', async () => {
		const paths = await createPaths();
		const audioFile = path.join(paths.configDir, 'audio.wav');
		await fs.writeFile(audioFile, wavBytes({ sampleRate: 44100 }));
		const execute = vi.fn(async (_command: string, args: readonly string[]) => {
			const output = args.at(-1);
			if (!output) throw new Error('missing output');
			await fs.writeFile(output, wavBytes());
		});
		stubAlignmentResponse();

		await new AudioCppAlignmentProvider(execute).align({ audioFile, config: createConfig(), paths, text: '任务' });

		expect(execute).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining(['-ar', '16000', '-ac', '1', '-sample_fmt', 's16']));
	});

	test('非 WAV 转成 16k 单声道 s16，上传后只清理临时文件', async () => {
		const paths = await createPaths();
		const audioFile = path.join(paths.configDir, 'audio.wav');
		await fs.writeFile(audioFile, 'not really wav');
		let convertedFile: string | undefined;
		const execute = vi.fn(async (_command: string, args: readonly string[]) => {
			convertedFile = args.at(-1);
			if (!convertedFile) throw new Error('missing output');
			await fs.writeFile(convertedFile, wavBytes());
		});
		stubAlignmentResponse();

		await new AudioCppAlignmentProvider(execute).align({ audioFile, config: createConfig(), paths, text: '任务' });

		expect(execute).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining(['-ar', '16000', '-ac', '1', '-sample_fmt', 's16']));
		await expect(fs.access(audioFile)).resolves.toBeUndefined();
		expect(convertedFile).toBeDefined();
		await expect(fs.access(convertedFile!)).rejects.toMatchObject({ code: 'ENOENT' });
	});
});

describe('VoiceBriefAlignmentService', () => {
	test('按音频内容和对齐参数缓存结果', async () => {
		const paths = await createPaths();
		const audioFile = path.join(paths.configDir, 'audio.wav');
		await fs.writeFile(audioFile, wavBytes());
		const config = createConfig();
		config.cache.enabled = true;
		config.cache.ttlMs = 60000;
		const fetch = stubAlignmentResponse();
		const module = {} as VoiceBriefRuntimeModule;
		(module as { cacheService: VoiceBriefCacheService }).cacheService = new VoiceBriefCacheService(module);
		const service = new VoiceBriefAlignmentService(module);
		const createTask = (): PreparedSpeechTask => ({
			brief: '任务',
			kind: 'final',
			config,
			paths,
			sequence: 0,
			eventContext: { briefId: 'brief-1', brief: { text: '任务', kind: 'final', priority: 'normal' } },
			audio: { provider: 'mock', source: 'provider' },
			result: { audioFile, provider: 'mock', source: 'provider' },
		});

		const first = service.start(createTask());
		if (!first) throw new Error('测试预期启动 alignment');
		await first.completion;
		const second = service.start(createTask());
		if (!second) throw new Error('测试预期启动 alignment');
		await second.completion;

		expect(fetch).toHaveBeenCalledOnce();
		expect(second.result).toEqual(first.result);
	});
});

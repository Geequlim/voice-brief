import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { VoiceBriefConfig } from '../src/config/schema';
import type { VoiceBriefPaths } from '../src/config/types';
import type { VoiceBriefRuntimeModule } from '../src/runtime';

const httpGet = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => {
	const mock = vi.fn();
	// 还原 execFile 自带的 custom promisify 行为，让 promisify 结果仍是 { stdout, stderr }
	mock[Symbol.for('nodejs.util.promisify.custom')] = (...args: unknown[]) =>
		new Promise((resolve, reject) => {
			mock(...args, (error: Error | null, stdout?: string, stderr?: string) => {
				if (error) reject(error);
				else resolve({ stdout, stderr });
			});
		});
	return mock;
});

vi.mock('../src/infrastructure/http', () => ({
	default: {
		get: httpGet,
		post: httpPost,
	},
}));

vi.mock('node:child_process', () => ({
	execFile: execFileMock,
}));

import { AudioCppProvider } from '../src/runtime/providers/audiocpp-provider';

function stubFfmpeg(meanVolume: string, maxVolume: string) {
	execFileMock.mockImplementation(((...callArgs: unknown[]) => {
		const callback = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
		const ffmpegArgs = (callArgs.slice(1).find(arg => Array.isArray(arg)) ?? []) as string[];
		if (ffmpegArgs.includes('volumedetect')) {
			callback(null, '', `[Parsed_volumedetect_0 @ 0x1] mean_volume: ${meanVolume} dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: ${maxVolume} dB\n`);
			return;
		}
		const output = ffmpegArgs[ffmpegArgs.length - 1];
		void fs.mkdir(path.dirname(output), { recursive: true })
			.then(() => fs.writeFile(output, Buffer.alloc(0)))
			.then(() => callback(null), error => callback(error as Error));
	}) as unknown as typeof execFile);
}

function transcodeCalls(): string[][] {
	return execFileMock.mock.calls
		.map(([, args]) => args as string[])
		.filter(args => !args.includes('volumedetect'));
}

function createConfig(overrides?: Partial<NonNullable<VoiceBriefConfig['providers']['audiocpp']>>): VoiceBriefConfig {
	return {
		providers: {
			audiocpp: {
				baseUrl: 'http://127.0.0.1:8080/v1',
				model: 'qwen3_tts_q8_0',
				...overrides,
			},
		},
	} as VoiceBriefConfig;
}

describe('AudioCppProvider', () => {
	beforeEach(() => {
		httpGet.mockReset();
		httpPost.mockReset();
		execFileMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test('通过 audio.cpp speech 接口合成音频并携带克隆参数', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const config = createConfig({
			voice: 'demo_3_woman',
			voiceRef: '/app/voices/alice.wav',
			referenceText: '参考文稿',
			seed: 1234,
		});
		const paths = { tempDir } as VoiceBriefPaths;
		httpPost.mockResolvedValue(new Uint8Array([4, 5, 6]));

		const result = await provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		});

		expect(httpPost).toHaveBeenCalledWith(
			'http://127.0.0.1:8080/v1/audio/speech',
			{
				model: 'qwen3_tts_q8_0',
				input: '你好',
				response_format: 'wav',
				voice: 'demo_3_woman',
				voice_ref: '/app/voices/alice.wav',
				reference_text: '参考文稿',
				seed: 1234,
			},
			{},
			{ responseType: 'arraybuffer' },
		);
		await expect(fs.readFile(result.audioFile)).resolves.toEqual(Buffer.from([4, 5, 6]));
		expect(result.provider).toBe('audiocpp');
		expect(result.audioFile.endsWith('.wav')).toBe(true);
	});

	test('未配置模型时合成直接报错', async () => {
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const config = createConfig({ model: undefined });
		const paths = { tempDir: '/tmp/unused' } as VoiceBriefPaths;

		await expect(provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		})).rejects.toThrow('未配置 TTS 模型');
	});

	test('配置 API Key 后请求携带 Authorization', async () => {
		vi.stubEnv('AUDIO_CPP_API_KEY', 'audiocpp-key');
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const paths = { tempDir } as VoiceBriefPaths;
		httpPost.mockResolvedValue(new Uint8Array([1]));

		await provider.synthesize({
			text: '你好',
			kind: 'final',
			config: createConfig(),
			paths,
		});

		expect(httpPost).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			{
				Authorization: 'Bearer audiocpp-key',
			},
			expect.anything(),
		);
	});

	test('本地 wav 参考音频会以 base64 形式发送', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const refFile = path.join(tempDir, 'ref.wav');
		const refContent = Buffer.concat([Buffer.from('RIFF$\0\0\0WAVEfmt ', 'latin1'), Buffer.from([1, 2, 3, 4])]);
		await fs.writeFile(refFile, refContent);
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const config = createConfig({ voiceRef: 'ref.wav' });
		const paths = { tempDir, personaDir: tempDir, cacheDir: path.join(tempDir, 'cache') } as VoiceBriefPaths;
		httpPost.mockResolvedValue(new Uint8Array([1]));

		await provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		});

		const request = httpPost.mock.calls[0][1] as { voice_ref?: unknown; };
		expect(request.voice_ref).toEqual({
			type: 'base64',
			data: `data:audio/wav;base64,${refContent.toString('base64')}`,
		});
	});

	test('本地 mp3 参考音频会转码为 wav 并写入缓存', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const refFile = path.join(tempDir, 'ref.mp3');
		await fs.writeFile(refFile, Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([1, 2, 3])]));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const config = createConfig({ voiceRef: 'ref.mp3' });
		const paths = { tempDir, personaDir: tempDir, cacheDir: path.join(tempDir, 'cache') } as VoiceBriefPaths;
		httpPost.mockResolvedValue(new Uint8Array([1]));
		const transcoded = Buffer.concat([Buffer.from('RIFF$\0\0\0WAVEfmt ', 'latin1'), Buffer.from([9, 9, 9])]);
		const spy = vi.spyOn(provider as unknown as { transcodeToWav: (input: string, output: string) => Promise<void>; }, 'transcodeToWav');
		spy.mockImplementation(async (input, output) => {
			await fs.mkdir(path.dirname(output), { recursive: true });
			await fs.writeFile(output, transcoded);
		});

		await provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		});
		await provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		});

		expect(spy).toHaveBeenCalledTimes(1);
		const request = httpPost.mock.calls[1][1] as { voice_ref?: unknown; };
		expect(request.voice_ref).toEqual({
			type: 'base64',
			data: `data:audio/wav;base64,${transcoded.toString('base64')}`,
		});
	});

	test('偏轻的 mp3 参考音频转码时按测量响度施加增益', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		stubFfmpeg('-28.7', '-11.3');

		await (provider as unknown as { transcodeToWav: (input: string, output: string) => Promise<void>; })
			.transcodeToWav(path.join(tempDir, 'ref.mp3'), path.join(tempDir, 'out.wav'));

		const transcodeArgs = transcodeCalls()[0];
		expect(transcodeArgs).toContain('-af');
		// -16 目标响度给出 12.7dB，但 -1.5dB 峰值上限把增益压到 9.8dB
		expect(transcodeArgs).toContain('volume=9.8dB');
	});

	test('响度达标的参考音频转码时不施加增益', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		stubFfmpeg('-15.9', '-1.4');

		await (provider as unknown as { transcodeToWav: (input: string, output: string) => Promise<void>; })
			.transcodeToWav(path.join(tempDir, 'ref.mp3'), path.join(tempDir, 'out.wav'));

		const transcodeArgs = transcodeCalls()[0];
		expect(transcodeArgs).not.toContain('-af');
	});

	test('响度测量失败时退回无增益转码', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		execFileMock.mockImplementation(((...callArgs: unknown[]) => {
			const callback = callArgs[callArgs.length - 1] as (error: Error | null) => void;
			const ffmpegArgs = (callArgs.slice(1).find(arg => Array.isArray(arg)) ?? []) as string[];
			if (ffmpegArgs.includes('volumedetect')) {
				callback(new Error('ffmpeg analyze failed'));
				return;
			}
			const output = ffmpegArgs[ffmpegArgs.length - 1];
			void fs.mkdir(path.dirname(output), { recursive: true })
				.then(() => fs.writeFile(output, Buffer.alloc(0)))
				.then(() => callback(null), error => callback(error as Error));
		}) as unknown as typeof execFile);

		await (provider as unknown as { transcodeToWav: (input: string, output: string) => Promise<void>; })
			.transcodeToWav(path.join(tempDir, 'ref.mp3'), path.join(tempDir, 'out.wav'));

		const transcodeArgs = transcodeCalls()[0];
		expect(transcodeArgs).not.toContain('-af');
	});

	test('不支持的参考音频格式会直接报错', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const refFile = path.join(tempDir, 'ref.bin');
		await fs.writeFile(refFile, new Uint8Array([1, 2, 3, 4]));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const config = createConfig({ voiceRef: 'ref.bin' });
		const paths = { tempDir, personaDir: tempDir } as VoiceBriefPaths;

		await expect(provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		})).rejects.toThrow('仅支持 wav 或 mp3');
	});

	test('模型未登记且配置自动加载时合成前会加载模型', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
		vi.stubGlobal('fetch', fetchMock);
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const config = createConfig({
			family: 'fish_audio',
			modelPath: '/app/models/Fish-Audio-S2-Pro-GGUF',
		});
		const paths = { tempDir } as VoiceBriefPaths;
		httpGet.mockResolvedValue({ data: [] });
		httpPost.mockResolvedValue(new Uint8Array([1]));

		await provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			'http://127.0.0.1:8080/v1/models/load',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					id: 'qwen3_tts_q8_0',
					family: 'fish_audio',
					path: '/app/models/Fish-Audio-S2-Pro-GGUF',
					task: 'tts',
					mode: 'offline',
				}),
			}),
		);
		expect(httpPost).toHaveBeenCalled();
	});

	test('模型已登记时不会触发自动加载', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const config = createConfig({
			family: 'fish_audio',
			modelPath: '/app/models/Fish-Audio-S2-Pro-GGUF',
		});
		const paths = { tempDir } as VoiceBriefPaths;
		httpGet.mockResolvedValue({ data: [{ id: 'qwen3_tts_q8_0', task: 'tts', loaded: true }] });
		httpPost.mockResolvedValue(new Uint8Array([1]));

		await provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('未配置 family 时从服务内置目录自动推断模型定义', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
		vi.stubGlobal('fetch', fetchMock);
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const catalogHtml = `<html><script>const catalog=[{"id":"qwen3_tts_q8_0","display_name":"示例","family":"fish_audio","path":"models/Qwen3-TTS-GGUF","task":"tts","mode":"offline"}];</script></html>`;
		httpGet.mockResolvedValueOnce({ models_root: '/app/models' })
			.mockResolvedValueOnce(catalogHtml)
			.mockResolvedValueOnce({ data: [] });
		httpPost.mockResolvedValue(new Uint8Array([1]));

		await provider.synthesize({
			text: '你好',
			kind: 'final',
			config: createConfig(),
			paths: { tempDir } as VoiceBriefPaths,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			'http://127.0.0.1:8080/v1/models/load',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					id: 'qwen3_tts_q8_0',
					family: 'fish_audio',
					path: '/app/models/Qwen3-TTS-GGUF',
					task: 'tts',
					mode: 'offline',
				}),
			}),
		);
		expect(httpPost).toHaveBeenCalled();
	});

	test('服务目录解析失败时不触发自动加载', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audiocpp-'));
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		const paths = { tempDir } as VoiceBriefPaths;
		httpGet.mockResolvedValueOnce({ models_root: '/app/models' })
			.mockResolvedValueOnce('<html>empty</html>');
		httpPost.mockResolvedValue(new Uint8Array([1]));

		await provider.synthesize({
			text: '你好',
			kind: 'final',
			config: createConfig(),
			paths,
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(httpGet).toHaveBeenCalledTimes(2);
		expect(httpPost).toHaveBeenCalled();
	});

	test('check 在模型未登记但配置自动加载时提示可自愈', async () => {
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		httpGet.mockResolvedValue({ data: [] });

		const result = await provider.check(createConfig({
			family: 'fish_audio',
			modelPath: '/app/models/Fish-Audio-S2-Pro-GGUF',
		}));

		expect(result.ok).toBe(true);
		expect(result.message).toContain('自动加载');
	});

	test('check 在服务未登记 TTS 模型时给出提示', async () => {
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		httpGet.mockResolvedValue({
			data: [
				{ id: 'qwen3_asr_0_6b_q8_0', task: 'asr' },
			],
		});

		const result = await provider.check(createConfig());

		expect(result.ok).toBe(false);
		expect(result.message).toContain('未登记 TTS 模型');
	});

	test('check 在配置的模型未登记时列出可用模型', async () => {
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		httpGet.mockResolvedValue({
			data: [
				{ id: 'pocket_tts_q8_0', task: 'tts' },
			],
		});

		const result = await provider.check(createConfig());

		expect(result.ok).toBe(false);
		expect(result.message).toContain('qwen3_tts_q8_0');
		expect(result.message).toContain('pocket_tts_q8_0');
	});

	test('check 在服务可达且模型登记时通过', async () => {
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		httpGet.mockResolvedValue({
			data: [
				{ id: 'qwen3_asr_0_6b_q8_0', task: 'asr' },
				{ id: 'qwen3_tts_q8_0', task: 'tts' },
			],
		});

		const result = await provider.check(createConfig());

		expect(httpGet).toHaveBeenCalledWith(
			'http://127.0.0.1:8080/v1/models',
			undefined,
			{},
		);
		expect(result.ok).toBe(true);
		expect(result.message).toContain('qwen3_tts_q8_0');
	});

	test('check 在服务不可达时报错', async () => {
		const provider = new AudioCppProvider({} as VoiceBriefRuntimeModule);
		httpGet.mockRejectedValue(new Error('connect ECONNREFUSED'));

		const result = await provider.check(createConfig());

		expect(result.ok).toBe(false);
		expect(result.message).toContain('不可达');
	});
});

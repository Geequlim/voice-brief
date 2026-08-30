import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { VoiceBriefConfig } from '../src/config/schema';
import type { VoiceBriefPaths } from '../src/config/types';
import type { VoiceBriefRuntimeModule } from '../src/runtime';

const httpPost = vi.hoisted(() => vi.fn());

vi.mock('../src/infrastructure/http', () => ({
	default: {
		post: httpPost,
	},
}));

import { OpenAiProvider } from '../src/runtime/providers/openai-provider';

describe('OpenAiProvider', () => {
	beforeEach(() => {
		httpPost.mockReset();
		vi.stubEnv('OPENAI_API_KEY', 'test-api-key');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test('通过 OpenAI 兼容 speech 接口合成音频', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-openai-'));
		const provider = new OpenAiProvider({} as VoiceBriefRuntimeModule);
		const config = {
			providers: {
				openai: {
					baseUrl: 'https://tts.example.com/v1',
					format: 'mp3',
					model: 'gpt-4o-mini-tts',
					voice: 'alloy',
				},
			},
		} as VoiceBriefConfig;
		const paths = { tempDir } as VoiceBriefPaths;
		httpPost.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		});

		expect(httpPost).toHaveBeenCalledWith(
			'https://tts.example.com/v1/audio/speech',
			{
				model: 'gpt-4o-mini-tts',
				input: '你好',
				voice: 'alloy',
				response_format: 'mp3',
			},
			{
				Authorization: 'Bearer test-api-key',
			},
			{ responseType: 'arraybuffer' },
		);
		await expect(fs.readFile(result.audioFile)).resolves.toEqual(Buffer.from([1, 2, 3]));
		expect(result.provider).toBe('openai');
		expect(result.audioFile.endsWith('.mp3')).toBe(true);
	});

	test('baseUrl 以斜杠结尾时端点拼接仍正确', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-openai-'));
		const provider = new OpenAiProvider({} as VoiceBriefRuntimeModule);
		const config = {
			providers: {
				openai: {
					baseUrl: 'https://tts.example.com/v1/',
				},
			},
		} as VoiceBriefConfig;
		const paths = { tempDir } as VoiceBriefPaths;
		httpPost.mockReset();
		httpPost.mockResolvedValue(new Uint8Array([1]));

		await provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		});

		expect(httpPost).toHaveBeenCalledWith(
			'https://tts.example.com/v1/audio/speech',
			expect.anything(),
			expect.anything(),
			expect.anything(),
		);
	});

	test('未设置 API Key 时合成直接报错', async () => {
		vi.unstubAllEnvs();
		const provider = new OpenAiProvider({} as VoiceBriefRuntimeModule);
		const config = { providers: {} } as VoiceBriefConfig;
		const paths = { tempDir: '/tmp/unused' } as VoiceBriefPaths;

		await expect(provider.synthesize({
			text: '你好',
			kind: 'final',
			config,
			paths,
		})).rejects.toThrow('OPENAI_API_KEY');
	});
});

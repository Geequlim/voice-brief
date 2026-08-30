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

import { FishProvider } from '../src/runtime/providers/fish-provider';

describe('FishProvider', () => {
	beforeEach(() => {
		httpPost.mockReset();
		vi.stubEnv('FISH_API_KEY', 'test-api-key');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test('通过 Fish Audio REST API 合成音频', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-fish-'));
		const provider = new FishProvider({} as VoiceBriefRuntimeModule);
		const config = {
			providers: {
				fish: {
					format: 'mp3',
					model: 's2-pro',
					referenceId: 'voice-id',
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
			'https://api.fish.audio/v1/tts',
			{
				text: '你好',
				format: 'mp3',
				reference_id: 'voice-id',
			},
			{
				Authorization: 'Bearer test-api-key',
				model: 's2-pro',
			},
			{ responseType: 'arraybuffer' },
		);
		await expect(fs.readFile(result.audioFile)).resolves.toEqual(Buffer.from([1, 2, 3]));
		expect(result.provider).toBe('fish');
	});
});

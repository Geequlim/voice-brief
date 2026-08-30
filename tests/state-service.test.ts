import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import type { VoiceBriefConfigModule } from '../src/config';
import { VoiceBriefStateService } from '../src/config/services/state-service';

describe('VoiceBriefStateService', () => {
	test('并发状态更新按顺序合并，不会互相覆盖', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-state-'));
		const stateFile = path.join(root, 'state.yaml');
		const module = {
			pathService: {
				ensureVoiceBriefDirs: async (): Promise<void> => undefined,
				resolveVoiceBriefPaths: async () => ({ stateFile }),
			},
		} as unknown as VoiceBriefConfigModule;
		const service = new VoiceBriefStateService(module);

		try {
			await Promise.all([
				service.update(async state => {
					await new Promise(resolve => setTimeout(resolve, 20));
					state.lastProviderError = 'provider failed';
				}),
				service.update(state => {
					state.lastPlaybackError = 'playback failed';
				}),
			]);

			await expect(service.load()).resolves.toMatchObject({
				lastProviderError: 'provider failed',
				lastPlaybackError: 'playback failed',
			});
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});

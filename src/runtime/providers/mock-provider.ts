import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProviderCacheDescriptor, ProviderCheckResult, SynthesizeInput, SynthesizeResult, TtsProvider } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';

export class MockProvider implements TtsProvider {
	readonly id = 'mock';

	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async check(): Promise<ProviderCheckResult> {
		return {
			ok: true,
			message: 'mock provider 可用',
		};
	}

	getCacheDescriptor(_input: SynthesizeInput): ProviderCacheDescriptor {
		return {
			extension: 'mock.txt',
			keyData: {
				outputText: true,
			},
		};
	}

	async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
		const audioFile = path.join(input.paths.tempDir, `voice-brief-${randomUUID()}.mock.txt`);
		await fs.mkdir(path.dirname(audioFile), { recursive: true });
		await fs.writeFile(audioFile, input.text, 'utf-8');
		return {
			audioFile,
			provider: this.id,
		};
	}
}

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseValue } from '../../infrastructure/schema';
import { SpeechAlignmentSchema } from '../../hook/schema';
import { AudioCppAlignmentProvider } from '../alignment-providers/audiocpp-alignment-provider';
import type { PreparedSpeechTask, RuntimeAlignmentTask, SpeechAlignment } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';

export class VoiceBriefAlignmentService {
	constructor(readonly module: VoiceBriefRuntimeModule) {}

	start(task: PreparedSpeechTask): RuntimeAlignmentTask | undefined {
		if (!task.config.alignment.enabled) return undefined;
		const alignmentTask: RuntimeAlignmentTask = {
			delivered: false,
			completion: Promise.resolve(),
		};
		alignmentTask.completion = this.resolve(task)
			.then(result => { alignmentTask.result = result; })
			.catch((): undefined => undefined);
		return alignmentTask;
	}

	private async resolve(task: PreparedSpeechTask): Promise<SpeechAlignment> {
		if (task.config.alignment.provider !== 'audiocpp') throw new Error(`未知 alignment provider: ${task.config.alignment.provider}`);
		const provider = new AudioCppAlignmentProvider();
		const cacheFile = await this.resolveCacheFile(task, provider.id);
		if (cacheFile) {
			const hit = await this.module.cacheService.readFreshCacheFile(cacheFile, task.config.cache.ttlMs);
			if (hit) return parseValue(SpeechAlignmentSchema, JSON.parse(await fs.readFile(hit, 'utf-8')) as unknown);
		}

		const result = await provider.align({
			audioFile: task.result.audioFile,
			config: task.config,
			paths: task.paths,
			text: task.brief,
		});
		if (cacheFile) await this.storeJson(cacheFile, result);
		return result;
	}

	private async resolveCacheFile(task: PreparedSpeechTask, provider: string) {
		if (!task.config.cache.enabled) return undefined;
		const audioHash = createHash('sha256').update(await fs.readFile(task.result.audioFile)).digest('hex');
		const config = task.config.alignment.audiocpp;
		const key = this.module.cacheService.createCacheKey(`alignment-${provider}`, task.brief, {
			extension: 'json',
			keyData: {
				adapterVersion: 1,
				audioHash,
				language: config?.language,
				model: config?.model,
			},
		});
		return this.module.cacheService.resolveCacheFile(task.paths, `alignment-${provider}`, key, 'json');
	}

	private async storeJson(targetFile: string, value: unknown) {
		await fs.mkdir(path.dirname(targetFile), { recursive: true });
		const tempFile = `${targetFile}.${process.pid}.${randomUUID()}.tmp`;
		await fs.writeFile(tempFile, `${JSON.stringify(value)}\n`, 'utf-8');
		await fs.rename(tempFile, targetFile);
	}
}

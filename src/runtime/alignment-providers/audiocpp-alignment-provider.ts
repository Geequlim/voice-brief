import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { AudioCppAlignmentConfig, VoiceBriefConfig } from '../../config/schema';
import type { VoiceBriefPaths } from '../../config/types';
import { createTimedSpeechAlignment } from '../alignment';
import type { SpeechAlignment } from '../types';
import { resolveAudioCppModelSource, type AudioCppCatalogEntry } from '../providers/audiocpp-model-catalog';

const executeFile = promisify(execFile);
type ExecuteFile = (file: string, args: readonly string[]) => Promise<unknown>;

interface AudioCppAlignmentWord {
	end: number;
	start: number;
	word: string;
}

interface AudioCppAlignmentResponse {
	words: AudioCppAlignmentWord[];
}

interface AudioCppModelsResponse {
	data: Array<{ id: string; loaded?: boolean; }>;
}

export interface AlignmentInput {
	audioFile: string;
	config: VoiceBriefConfig;
	paths: VoiceBriefPaths;
	text: string;
}

export class AudioCppAlignmentProvider {
	readonly id = 'audiocpp';
	private readonly $catalogCache = new Map<string, Map<string, AudioCppCatalogEntry>>();
	constructor(private readonly $executeFile: ExecuteFile = executeFile) {}

	async align(input: AlignmentInput): Promise<SpeechAlignment> {
		const config = input.config.alignment.audiocpp;
		if (!config?.baseUrl || !config.model) throw new Error('audio.cpp alignment 配置缺少 baseUrl 或 model');
		await this.ensureModelReady(config);
		const prepared = await this.prepareAudio(input.audioFile, input.paths.tempDir);
		try {
			const audio = await fs.readFile(prepared.file);
			const form = new FormData();
			form.append('file', new Blob([audio], { type: 'audio/wav' }), 'alignment.wav');
			form.append('model', config.model);
			form.append('text', input.text);
			if (config.language) form.append('language', config.language);

			const headers = this.createHeaders(config);
			const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/audio/alignments`, {
				method: 'POST',
				headers,
				body: form,
				signal: AbortSignal.timeout(config.timeoutMs ?? 120000),
			});
			if (!response.ok) throw new Error(`audio.cpp alignment 请求失败: HTTP ${response.status} ${await response.text()}`);
			const result = this.parseResponse(await response.json());
			return createTimedSpeechAlignment({
				text: input.text,
				source: `audiocpp:${config.model}`,
				cues: result.words.map(word => ({ text: word.word, startMs: word.start * 1_000, endMs: word.end * 1_000 })),
			});
		} finally {
			if (prepared.temporary) await fs.rm(prepared.file, { force: true }).catch((): undefined => undefined);
		}
	}

	private async ensureModelReady(config: AudioCppAlignmentConfig) {
		if (!config.baseUrl || !config.model) return;
		const headers = this.createHeaders(config);
		const timeoutMs = config.timeoutMs ?? 120000;
		const baseUrl = config.baseUrl.replace(/\/+$/, '');
		const source = await resolveAudioCppModelSource({
			baseUrl,
			family: config.family,
			model: config.model,
			modelPath: config.modelPath,
			task: 'align',
			headers,
			cache: this.$catalogCache,
		});
		if (!source) return;
		const modelsResponse = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(timeoutMs) });
		if (!modelsResponse.ok) throw new Error(`audio.cpp 获取 alignment 模型列表失败: HTTP ${modelsResponse.status} ${await modelsResponse.text()}`);
		const models = await modelsResponse.json() as AudioCppModelsResponse;
		if (models.data.some(model => model.id === config.model && model.loaded)) return;

		const response = await fetch(`${baseUrl}/models/load`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify({ id: config.model, family: source.family, path: source.path, task: source.task, mode: source.mode }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) throw new Error(`audio.cpp 自动加载 alignment 模型失败: ${config.model} (${response.status} ${(await response.text()).slice(0, 200)})`);
	}

	private createHeaders(config: AudioCppAlignmentConfig): Record<string, string> {
		if (!config.apiKeyEnv) return {};
		const apiKey = process.env[config.apiKeyEnv];
		if (!apiKey) throw new Error(`环境变量 ${config.apiKeyEnv} 未设置`);
		return { authorization: `Bearer ${apiKey}` };
	}

	private async prepareAudio(audioFile: string, tempDir: string) {
		if (await this.isAlignmentReadyWav(audioFile)) return { file: audioFile, temporary: false };

		await fs.mkdir(tempDir, { recursive: true });
		const output = path.join(tempDir, `alignment-${randomUUID()}.wav`);
		try {
			await this.$executeFile('ffmpeg', ['-y', '-loglevel', 'error', '-i', audioFile, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', output]);
			return { file: output, temporary: true };
		} catch (error) {
			await fs.rm(output, { force: true }).catch((): undefined => undefined);
			throw new Error(`alignment 音频转码失败，请确认本机已安装 ffmpeg: ${(error as Error).message}`);
		}
	}

	private async isAlignmentReadyWav(audioFile: string) {
		const header = Buffer.alloc(64 * 1024);
		const handle = await fs.open(audioFile, 'r');
		let bytesRead = 0;
		try {
			({ bytesRead } = await handle.read(header, 0, header.length, 0));
		} finally {
			await handle.close();
		}
		const data = header.subarray(0, bytesRead);
		if (data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') return false;
		let offset = 12;
		while (offset + 8 <= data.length) {
			const chunkId = data.toString('ascii', offset, offset + 4);
			const chunkSize = data.readUInt32LE(offset + 4);
			const chunkDataOffset = offset + 8;
			if (chunkId === 'fmt ') {
				if (chunkSize < 16 || chunkDataOffset + 16 > data.length) return false;
				return data.readUInt16LE(chunkDataOffset) === 1
					&& data.readUInt16LE(chunkDataOffset + 2) === 1
					&& data.readUInt32LE(chunkDataOffset + 4) === 16000
					&& data.readUInt16LE(chunkDataOffset + 14) === 16;
			}
			const nextOffset = chunkDataOffset + chunkSize + (chunkSize % 2);
			if (nextOffset <= offset) return false;
			offset = nextOffset;
		}
		return false;
	}

	private parseResponse(value: unknown): AudioCppAlignmentResponse {
		if (!this.isRecord(value) || !Array.isArray(value['words'])) throw new Error('audio.cpp alignment 返回格式无效');
		const words = value['words'].map((word, index) => {
			if (!this.isRecord(word) || typeof word['word'] !== 'string' || typeof word['start'] !== 'number' || typeof word['end'] !== 'number') {
				throw new Error(`audio.cpp alignment words[${index}] 格式无效`);
			}
			return { word: word['word'], start: word['start'], end: word['end'] };
		});
		return { words };
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}
}

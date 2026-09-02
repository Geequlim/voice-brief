import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { VoiceBriefConfig } from '../../config/schema';
import type { VoiceBriefPaths } from '../../config/types';
import { createTimedSpeechAlignment } from '../alignment';
import type { SpeechAlignment } from '../types';

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

export interface AlignmentInput {
	audioFile: string;
	config: VoiceBriefConfig;
	paths: VoiceBriefPaths;
	text: string;
}

export class AudioCppAlignmentProvider {
	readonly id = 'audiocpp';
	constructor(private readonly $executeFile: ExecuteFile = executeFile) {}

	async align(input: AlignmentInput): Promise<SpeechAlignment> {
		const config = input.config.alignment.audiocpp;
		if (!config?.baseUrl || !config.model) throw new Error('audio.cpp alignment 配置缺少 baseUrl 或 model');
		const prepared = await this.prepareAudio(input.audioFile, input.paths.tempDir);
		try {
			const audio = await fs.readFile(prepared.file);
			const form = new FormData();
			form.append('file', new Blob([audio], { type: 'audio/wav' }), 'alignment.wav');
			form.append('model', config.model);
			form.append('text', input.text);
			if (config.language) form.append('language', config.language);

			const headers: Record<string, string> = {};
			if (config.apiKeyEnv) {
				const apiKey = process.env[config.apiKeyEnv];
				if (!apiKey) throw new Error(`环境变量 ${config.apiKeyEnv} 未设置`);
				headers['authorization'] = `Bearer ${apiKey}`;
			}
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

	private async prepareAudio(audioFile: string, tempDir: string) {
		const header = Buffer.alloc(12);
		const handle = await fs.open(audioFile, 'r');
		try {
			await handle.read(header, 0, header.length, 0);
		} finally {
			await handle.close();
		}
		if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE') {
			return { file: audioFile, temporary: false };
		}

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

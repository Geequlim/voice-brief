import http from '../../infrastructure/http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AudioCppProviderConfig, VoiceBriefConfig } from '../../config/schema';
import type { VoiceBriefPaths } from '../../config/types';
import type { VoicePersona } from '../../persona/types';
import type { ProviderCacheDescriptor, ProviderCheckResult, SynthesizeInput, SynthesizeResult } from '../types';
import type { OpenAiSpeechRequest } from './openai-provider';
import { OpenAiProvider } from './openai-provider';

const $execFile = promisify(execFile);

type AudioCppSpeechRequest = OpenAiSpeechRequest & {
	voice_ref?: string | { type: 'base64'; data: string; };
	reference_text?: string;
	seed?: number;
};

type AudioCppModelsResponse = {
	data: Array<{ id: string; task?: string; loaded?: boolean; }>;
};

type AudioCppCatalogEntry = {
	id: string;
	family?: string;
	path?: string;
	task?: string;
	mode?: string;
};

type AudioCppModelSource = {
	family: string;
	path: string;
	task: string;
	mode: string;
};

export class AudioCppProvider extends OpenAiProvider {
	override readonly id = 'audiocpp';

	protected override readonly $defaultApiKeyEnv = 'AUDIO_CPP_API_KEY';
	protected override readonly $defaultBaseUrl = 'http://127.0.0.1:8080/v1';
	private readonly $voiceRefMaxBytes = 5 * 1024 * 1024;
	private readonly $modelLoadTimeoutMs = 120000;
	// fish 克隆会复刻参考音频的响度，参考之间响度差会直接传导到合成结果，转码时统一增益到目标响度
	private readonly $voiceRefTargetMeanDb = -16;
	private readonly $voiceRefPeakCeilingDb = -1.5;
	private readonly $voiceRefCacheTag = 'loudnorm-v1';
	private readonly $catalogCache = new Map<string, Map<string, AudioCppCatalogEntry>>();

	override async check(config: VoiceBriefConfig): Promise<ProviderCheckResult> {
		const options = this.getOptions(config);
		let response: AudioCppModelsResponse;
		try {
			response = await http.get<AudioCppModelsResponse>(this.modelsUrl(options), undefined, this.createHeaders(options));
		} catch {
			return {
				ok: false,
				message: `audio.cpp 服务不可达: ${options.baseUrl ?? this.$defaultBaseUrl}`,
			};
		}
		const ttsModels = response.data.filter(model => model.task === 'tts');
		if (!ttsModels.length) {
			if (await this.resolveModelSource(options)) {
				return {
					ok: true,
					message: `audio.cpp 当前未登记 TTS 模型，${options.model} 可自动加载，合成时会自动恢复`,
				};
			}
			return {
				ok: false,
				message: 'audio.cpp 服务可达，但未登记 TTS 模型，请先在服务端配置中加载',
			};
		}
		const availableIds = ttsModels.map(model => model.id).join(', ');
		if (options.model && !ttsModels.some(model => model.id === options.model)) {
			if (await this.resolveModelSource(options)) {
				return {
					ok: true,
					message: `audio.cpp 未登记配置的 TTS 模型: ${options.model}，可自动加载，合成时会自动恢复`,
				};
			}
			return {
				ok: false,
				message: `audio.cpp 未登记配置的 TTS 模型: ${options.model}，可用模型: ${availableIds}`,
			};
		}
		return {
			ok: true,
			message: `audio.cpp 配置可用，TTS 模型: ${availableIds}`,
		};
	}

	override getCacheDescriptor(input: SynthesizeInput): ProviderCacheDescriptor {
		const options = this.getOptions(input.config, input.persona);
		return {
			extension: 'wav',
			keyData: {
				baseUrl: options.baseUrl ?? this.$defaultBaseUrl,
				family: options.family,
				model: options.model,
				modelPath: options.modelPath,
				referenceText: options.referenceText,
				seed: options.seed,
				voice: options.voice,
				voiceRef: options.voiceRef,
			},
		};
	}

	override async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
		await this.ensureModelReady(this.getOptions(input.config, input.persona));
		return super.synthesize(input);
	}

	private async resolveModelSource(options: AudioCppProviderConfig): Promise<AudioCppModelSource | undefined> {
		if (options.family && options.modelPath) {
			return { family: options.family, path: options.modelPath, task: 'tts', mode: 'offline' };
		}
		const entry = await this.fetchCatalogEntry(options);
		if (!entry?.family || !entry?.path) return undefined;
		return {
			family: entry.family,
			path: entry.path,
			task: entry.task ?? 'tts',
			mode: entry.mode ?? 'offline',
		};
	}

	private async fetchCatalogEntry(options: AudioCppProviderConfig): Promise<AudioCppCatalogEntry | undefined> {
		const baseUrl = options.baseUrl ?? this.$defaultBaseUrl;
		let catalog = this.$catalogCache.get(baseUrl);
		if (!catalog) {
			catalog = await this.parseCatalog(baseUrl, this.createHeaders(options));
			this.$catalogCache.set(baseUrl, catalog);
		}
		return options.model ? catalog.get(options.model) : undefined;
	}

	private async parseCatalog(baseUrl: string, headers: Record<string, string>): Promise<Map<string, AudioCppCatalogEntry>> {
		const catalog = new Map<string, AudioCppCatalogEntry>();
		try {
			const root = await http.get<{ models_root?: string; }>(this.joinUrl(baseUrl, 'ui/models-root'), undefined, headers);
			const html = await http.get<string>(new URL(baseUrl).origin, undefined, headers);
			for (const entry of this.extractCatalogEntries(html)) {
				entry.path = this.resolveModelPath(entry.path ?? '', root.models_root ?? '/app/models');
				catalog.set(entry.id, entry);
			}
		} catch {
			return catalog;
		}
		return catalog;
	}

	private resolveModelPath(modelPath: string, modelsRoot: string) {
		if (path.isAbsolute(modelPath)) return modelPath;
		return path.join(path.dirname(modelsRoot), modelPath);
	}

	private extractCatalogEntries(html: string): AudioCppCatalogEntry[] {
		const entries: AudioCppCatalogEntry[] = [];
		const seen = new Set<string>();
		let cursor = 0;
		while (entries.length < 200) {
			const marker = html.indexOf('"id":"', cursor);
			if (marker < 0) break;
			cursor = marker + 6;
			const end = this.extractJsonEntry(html, marker);
			if (end < 0) continue;
			const start = html.lastIndexOf('{', marker);
			try {
				const entry = JSON.parse(html.slice(start, end)) as AudioCppCatalogEntry;
				if (entry?.id && entry.family && entry.path && !seen.has(entry.id)) {
					seen.add(entry.id);
					entries.push(entry);
				}
			} catch {}
		}
		return entries;
	}

	private extractJsonEntry(html: string, marker: number) {
		const start = html.lastIndexOf('{', marker);
		if (start < 0) return -1;
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let i = start; i < html.length; i++) {
			const ch = html[i];
			if (escaped) { escaped = false; continue; }
			if (ch === '\\') { escaped = true; continue; }
			if (ch === '"') { inString = !inString; continue; }
			if (inString) continue;
			if (ch === '{') depth++;
			if (ch === '}') {
				depth--;
				if (depth === 0) return i + 1;
			}
		}
		return -1;
	}

	private async ensureModelReady(options: AudioCppProviderConfig) {
		if (!options.model) return;
		const source = await this.resolveModelSource(options);
		if (!source) return;
		const models = await http.get<AudioCppModelsResponse>(this.modelsUrl(options), undefined, this.createHeaders(options));
		if (models.data.some(model => model.id === options.model && model.loaded)) return;
		// 模型加载可能远超通用 http 工具的 15 秒固定超时，此处用 fetch 长超时；已卸载的模型也显式加载，避免合成时透明重载超时
		const response = await fetch(this.modelsLoadUrl(options), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...this.createHeaders(options) },
			body: JSON.stringify({
				id: options.model,
				family: source.family,
				path: source.path,
				task: source.task,
				mode: source.mode,
			}),
			signal: AbortSignal.timeout(this.$modelLoadTimeoutMs),
		});
		if (!response.ok) throw new Error(`audio.cpp 自动加载模型失败: ${options.model} (${response.status} ${(await response.text()).slice(0, 200)})`);
	}

	protected override getOptions(config: VoiceBriefConfig, persona?: VoicePersona): AudioCppProviderConfig {
		return {
			...config.providers.audiocpp,
			...persona?.audiocpp,
		};
	}

	protected override async createRequest(text: string, options: AudioCppProviderConfig, paths?: VoiceBriefPaths): Promise<AudioCppSpeechRequest> {
		const model = options.model;
		if (!model) throw new Error('audio.cpp 未配置 TTS 模型，请在 providers.audiocpp.model 中指定');
		const request: AudioCppSpeechRequest = {
			model,
			input: text,
			response_format: 'wav',
		};
		if (options.voice) request.voice = options.voice;
		if (options.voiceRef) request.voice_ref = await this.resolveVoiceRef(options.voiceRef, paths);
		if (options.referenceText) request.reference_text = options.referenceText;
		if (options.seed !== undefined) request.seed = options.seed;
		return request;
	}

	private async resolveVoiceRef(voiceRef: string, paths?: VoiceBriefPaths): Promise<AudioCppSpeechRequest['voice_ref']> {
		const file = path.isAbsolute(voiceRef) ? voiceRef : paths ? path.join(paths.personaDir, voiceRef) : voiceRef;
		let content: Buffer;
		try {
			content = await fs.readFile(file);
		} catch {
			return voiceRef;
		}
		const audio = await this.ensureWavContent(file, content, paths);
		if (audio.byteLength > this.$voiceRefMaxBytes) throw new Error(`voiceRef 参考音频超过 5MiB 上限: ${file}`);
		return {
			type: 'base64',
			data: `data:audio/wav;base64,${audio.toString('base64')}`,
		};
	}

	private async ensureWavContent(file: string, content: Buffer, paths?: VoiceBriefPaths): Promise<Buffer> {
		if (this.isWav(content)) return content;
		if (!this.isMp3(content)) throw new Error(`voiceRef 参考音频格式不支持，仅支持 wav 或 mp3: ${file}`);
		if (!paths) throw new Error('voiceRef 为 mp3 时需要 paths 中的缓存目录来存放转码结果');
		const cacheFile = path.join(paths.cacheDir, 'audiocpp', 'voice-refs', `${createHash('sha256').update(content).update(this.$voiceRefCacheTag).digest('hex')}.wav`);
		if (await this.existsFile(cacheFile)) return fs.readFile(cacheFile);
		await this.transcodeToWav(file, cacheFile);
		return fs.readFile(cacheFile);
	}

	private async transcodeToWav(input: string, output: string) {
		await fs.mkdir(path.dirname(output), { recursive: true });
		try {
			const gainDb = await this.measureRefGain(input);
			const filterArgs = gainDb === undefined ? [] : ['-af', `volume=${gainDb.toFixed(1)}dB`];
			await $execFile('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, ...filterArgs, '-ar', '44100', '-ac', '1', '-sample_fmt', 's16', output]);
		} catch (error) {
			await fs.rm(output, { force: true });
			throw new Error(`voiceRef 参考音频转码失败，请确认本机已安装 ffmpeg: ${(error as Error).message}`);
		}
	}

	// 测量参考音频响度并计算统一增益；峰值同时受 -1.5dB 上限约束避免削波。测量失败时退回无增益转码
	private async measureRefGain(input: string): Promise<number | undefined> {
		try {
			const { stderr } = await $execFile('ffmpeg', ['-i', input, '-af', 'volumedetect', '-f', 'null', '-'], { maxBuffer: 4 * 1024 * 1024 });
			const mean = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(stderr)?.[1];
			const max = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(stderr)?.[1];
			if (!mean || !max) return undefined;
			const gain = Math.min(this.$voiceRefTargetMeanDb - Number(mean), this.$voiceRefPeakCeilingDb - Number(max));
			return Math.abs(gain) < 0.3 ? undefined : Math.round(gain * 10) / 10;
		} catch {
			return undefined;
		}
	}

	private isWav(content: Buffer) {
		return content.length > 12 && content.toString('latin1', 0, 4) === 'RIFF' && content.toString('latin1', 8, 12) === 'WAVE';
	}

	private isMp3(content: Buffer) {
		if (content.length > 3 && content.toString('latin1', 0, 3) === 'ID3') return true;
		return content.length > 2 && content[0] === 0xff && (content[1] & 0xe0) === 0xe0;
	}

	private async existsFile(file: string) {
		try {
			await fs.access(file);
			return true;
		} catch {
			return false;
		}
	}

	protected override createHeaders(options: AudioCppProviderConfig): Record<string, string> {
		const envName = options.apiKeyEnv ?? this.$defaultApiKeyEnv;
		const key = process.env[envName];
		if (!key) return {};
		return {
			Authorization: `Bearer ${key}`,
		};
	}

	protected override getExtension() {
		return 'wav';
	}

	private modelsUrl(options: AudioCppProviderConfig) {
		return this.joinUrl(options.baseUrl ?? this.$defaultBaseUrl, 'models');
	}

	private modelsLoadUrl(options: AudioCppProviderConfig) {
		return this.joinUrl(options.baseUrl ?? this.$defaultBaseUrl, 'models/load');
	}
}

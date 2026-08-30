import http from '../../infrastructure/http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FishProviderConfig, VoiceBriefConfig } from '../../config/schema';
import type { VoicePersona } from '../../persona/types';
import type { VoiceBriefRuntimeModule } from '../index';
import type { ProviderCacheDescriptor, ProviderCheckResult, SynthesizeInput, SynthesizeResult, TtsProvider } from '../types';

type FishTtsRequest = {
	text: string;
	reference_id?: string;
	format?: FishProviderConfig['format'];
};

export class FishProvider implements TtsProvider {
	readonly id = 'fish';

	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async check(config: VoiceBriefConfig): Promise<ProviderCheckResult> {
		const options = config.providers.fish;
		const envName = options.apiKeyEnv ?? 'FISH_API_KEY';
		if (!process.env[envName]) {
			return {
				ok: false,
				message: `Fish Audio API Key 未设置: ${envName}`,
			};
		}
		return {
			ok: true,
			message: `Fish Audio 配置可用，API Key 来源: ${envName}`,
		};
	}

	getCacheDescriptor(input: SynthesizeInput): ProviderCacheDescriptor {
		const options = this.getFishOptions(input.config, input.persona);
		return {
			extension: options.format ?? 'mp3',
			keyData: {
				baseUrl: options.baseUrl ?? 'https://api.fish.audio',
				format: options.format ?? 'mp3',
				model: options.model ?? 's2-pro',
				referenceId: options.referenceId,
			},
		};
	}

	async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
		const options = this.getFishOptions(input.config, input.persona);
		const request = this.createRequest(input.text, options);
		const response = await this.requestAudio(options, request);
		const audio = this.toAudioBuffer(response);
		const extension = options.format ?? 'mp3';
		const audioFile = path.join(input.paths.tempDir, `voice-brief-${randomUUID()}.${extension}`);
		await fs.mkdir(path.dirname(audioFile), { recursive: true });
		await fs.writeFile(audioFile, audio);
		return {
			audioFile,
			provider: this.id,
		};
	}

	private async requestAudio(options: FishProviderConfig, request: FishTtsRequest) {
		return http.post<ArrayBuffer | ArrayBufferView>(
			this.ttsUrl(options),
			request,
			this.createHeaders(options),
			{ responseType: 'arraybuffer' },
		);
	}

	private getFishOptions(config: VoiceBriefConfig, persona?: VoicePersona): FishProviderConfig {
		return {
			...config.providers.fish,
			...persona?.fish,
		};
	}

	private getApiKey(config: FishProviderConfig) {
		const envName = config.apiKeyEnv ?? 'FISH_API_KEY';
		const key = process.env[envName];
		if (!key) throw new Error(`缺少 Fish Audio API Key，请设置环境变量 ${envName}`);
		return key;
	}

	private createHeaders(options: FishProviderConfig) {
		return {
			Authorization: `Bearer ${this.getApiKey(options)}`,
			model: options.model ?? 's2-pro',
		};
	}

	private ttsUrl(options: FishProviderConfig) {
		const baseUrl = options.baseUrl ?? 'https://api.fish.audio';
		return new URL('/v1/tts', baseUrl).href;
	}

	private createRequest(text: string, options: FishProviderConfig) {
		const request: FishTtsRequest = { text };
		if (options.format) request.format = options.format;
		if (options.referenceId) request.reference_id = options.referenceId;
		return request;
	}

	private toAudioBuffer(response: ArrayBuffer | ArrayBufferView) {
		if (Buffer.isBuffer(response)) return response;
		if (response instanceof ArrayBuffer) return Buffer.from(response);
		return Buffer.from(response.buffer, response.byteOffset, response.byteLength);
	}
}

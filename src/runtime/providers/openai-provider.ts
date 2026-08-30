import http from '../../infrastructure/http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { OpenAiProviderConfig, VoiceBriefConfig } from '../../config/schema';
import type { VoiceBriefPaths } from '../../config/types';
import type { VoicePersona } from '../../persona/types';
import type { VoiceBriefRuntimeModule } from '../index';
import type { ProviderCacheDescriptor, ProviderCheckResult, SynthesizeInput, SynthesizeResult, TtsProvider } from '../types';

export type OpenAiSpeechRequest = {
	model: string;
	input: string;
	voice?: string;
	response_format?: OpenAiProviderConfig['format'];
};

export class OpenAiProvider implements TtsProvider {
	readonly id: string = 'openai';

	protected readonly $defaultApiKeyEnv: string = 'OPENAI_API_KEY';
	protected readonly $defaultBaseUrl: string = 'https://api.openai.com/v1';
	protected readonly $defaultFormat: string = 'mp3';
	protected readonly $defaultModel: string = 'gpt-4o-mini-tts';
	protected readonly $defaultVoice: string = 'alloy';

	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async check(config: VoiceBriefConfig): Promise<ProviderCheckResult> {
		const options = this.getOptions(config);
		const envName = options.apiKeyEnv ?? this.$defaultApiKeyEnv;
		if (!process.env[envName]) {
			return {
				ok: false,
				message: `OpenAI API Key 未设置: ${envName}`,
			};
		}
		return {
			ok: true,
			message: `OpenAI 兼容配置可用，端点: ${this.speechUrl(options)}`,
		};
	}

	getCacheDescriptor(input: SynthesizeInput): ProviderCacheDescriptor {
		const options = this.getOptions(input.config, input.persona);
		const format = options.format ?? this.$defaultFormat;
		return {
			extension: format,
			keyData: {
				baseUrl: options.baseUrl ?? this.$defaultBaseUrl,
				format,
				model: options.model ?? this.$defaultModel,
				voice: options.voice ?? this.$defaultVoice,
			},
		};
	}

	async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
		const options = this.getOptions(input.config, input.persona);
		const request = await this.createRequest(input.text, options, input.paths);
		const response = await http.post<ArrayBuffer | ArrayBufferView>(this.speechUrl(options), request, this.createHeaders(options), { responseType: 'arraybuffer' });
		const audioFile = path.join(input.paths.tempDir, `voice-brief-${randomUUID()}.${this.getExtension(options)}`);
		await fs.mkdir(path.dirname(audioFile), { recursive: true });
		await fs.writeFile(audioFile, this.toAudioBuffer(response));
		return {
			audioFile,
			provider: this.id,
		};
	}

	protected getOptions(config: VoiceBriefConfig, persona?: VoicePersona): OpenAiProviderConfig {
		return {
			...config.providers.openai,
			...persona?.openai,
		};
	}

	protected async createRequest(text: string, options: OpenAiProviderConfig, paths?: VoiceBriefPaths): Promise<OpenAiSpeechRequest> {
		const request: OpenAiSpeechRequest = {
			model: options.model ?? this.$defaultModel,
			input: text,
		};
		if (options.voice) request.voice = options.voice;
		if (options.format) request.response_format = options.format;
		return request;
	}

	protected createHeaders(options: OpenAiProviderConfig): Record<string, string> {
		return {
			Authorization: `Bearer ${this.getApiKey(options)}`,
		};
	}

	protected speechUrl(options: OpenAiProviderConfig) {
		return this.joinUrl(options.baseUrl ?? this.$defaultBaseUrl, 'audio/speech');
	}

	protected getExtension(options: OpenAiProviderConfig) {
		return options.format ?? this.$defaultFormat;
	}

	protected joinUrl(baseUrl: string, suffix: string) {
		return new URL(suffix, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
	}

	protected getApiKey(options: OpenAiProviderConfig) {
		const envName = options.apiKeyEnv ?? this.$defaultApiKeyEnv;
		const key = process.env[envName];
		if (!key) throw new Error(`缺少 OpenAI API Key，请设置环境变量 ${envName}`);
		return key;
	}

	protected toAudioBuffer(response: ArrayBuffer | ArrayBufferView) {
		if (Buffer.isBuffer(response)) return response;
		if (response instanceof ArrayBuffer) return Buffer.from(response);
		return Buffer.from(response.buffer, response.byteOffset, response.byteLength);
	}
}

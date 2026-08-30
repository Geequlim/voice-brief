import fs from 'node:fs/promises';
import { AudioCppProvider } from '../providers/audiocpp-provider';
import { EdgeProvider } from '../providers/edge-provider';
import { FishProvider } from '../providers/fish-provider';
import { MockProvider } from '../providers/mock-provider';
import { OpenAiProvider } from '../providers/openai-provider';
import type { VoiceBriefConfig } from '../../config/schema';
import type { VoiceBriefPaths } from '../../config/types';
import type { VoicePersona } from '../../persona/types';
import type { BriefKind, PreparedAudioResult, ProviderSynthesisTask, SynthesizeInput, TtsProvider } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';

interface ProviderGate {
	active: number;
	limit: number;
}

export class VoiceBriefProviderBusyError extends Error {
	constructor(readonly providerId: string) {
		super(`TTS provider 正在满负载合成: ${providerId}`);
		this.name = 'VoiceBriefProviderBusyError';
	}
}

export class VoiceBriefProviderService {
	private readonly $providerIds = ['fish', 'edge', 'mock', 'openai', 'audiocpp'] as const;
	private readonly $providerGates = new Map<string, ProviderGate>();

	constructor(readonly module: VoiceBriefRuntimeModule) {}

	listProviderIds() {
		return [...this.$providerIds];
	}

	getProvider(id: string): TtsProvider {
		if (id === 'fish') return new FishProvider(this.module);
		if (id === 'edge') return new EdgeProvider(this.module);
		if (id === 'mock') return new MockProvider(this.module);
		if (id === 'openai') return new OpenAiProvider(this.module);
		if (id === 'audiocpp') return new AudioCppProvider(this.module);
		throw new Error(`未知 TTS provider: ${id}`);
	}

	async checkAll(config: VoiceBriefConfig) {
		const checks = [];
		for (const id of this.$providerIds) {
			const provider = this.getProvider(id);
			checks.push({
				id: provider.id,
				...(await provider.check(config)),
			});
		}
		return checks;
	}

	async startSynthesisWithFallback(paths: VoiceBriefPaths, config: VoiceBriefConfig, persona: VoicePersona | undefined, kind: BriefKind, text: string): Promise<ProviderSynthesisTask> {
		const primary = persona?.provider || config.provider;
		const fallback = persona?.fallbackProvider || config.fallbackProvider;
		try {
			const task = await this.startAttempt(primary, paths, config, persona, kind, text);
			if (!fallback || fallback === primary || task.source === 'cache') return task;
			return {
				...task,
				result: task.result.catch(async () => {
					const fallbackTask = await this.startAttempt(fallback, paths, config, persona, kind, text);
					return fallbackTask.result;
				}),
			};
		} catch (error) {
			if (!fallback || fallback === primary) throw error;
			return this.startAttempt(fallback, paths, config, persona, kind, text);
		}
	}

	private async startAttempt(providerId: string, paths: VoiceBriefPaths, config: VoiceBriefConfig, persona: VoicePersona | undefined, kind: BriefKind, text: string): Promise<ProviderSynthesisTask> {
		const provider = this.getProvider(providerId);
		const input = { text, kind, persona, config, paths };
		const descriptor = provider.getCacheDescriptor(input);
		let cacheFile: string | undefined;

		if (config.cache.enabled) {
			const cacheKey = this.module.cacheService.createCacheKey(provider.id, text, descriptor);
			cacheFile = this.module.cacheService.resolveCacheFile(paths, provider.id, cacheKey, descriptor.extension);
			const hit = await this.module.cacheService.readFreshCacheFile(cacheFile, config.cache.ttlMs);
			if (hit) {
				return {
					provider: provider.id,
					source: 'cache' as const,
					result: Promise.resolve({ audioFile: hit, provider: provider.id, source: 'cache' }),
				};
			}
		}

		const release = this.tryAcquireProviderSlot(provider.id, this.resolveConcurrency(config, provider.id));
		if (!release) throw new VoiceBriefProviderBusyError(provider.id);
		try {
			if (cacheFile) {
				const hit = await this.module.cacheService.readFreshCacheFile(cacheFile, config.cache.ttlMs);
				if (hit) {
					release();
					return {
						provider: provider.id,
						source: 'cache' as const,
						result: Promise.resolve({ audioFile: hit, provider: provider.id, source: 'cache' }),
					};
				}
			}
			return {
				provider: provider.id,
				source: 'provider' as const,
				result: this.synthesize(provider, input, cacheFile, release),
			};
		} catch (error) {
			release();
			throw error;
		}
	}

	private async synthesize(provider: TtsProvider, input: SynthesizeInput, cacheFile: string | undefined, release: () => void): Promise<PreparedAudioResult> {
		try {
			const result = await provider.synthesize(input);
			if (!cacheFile) return { ...result, source: 'provider' };
			await this.module.cacheService.storeCacheFile(result.audioFile, cacheFile);
			await this.removeTempFile(result.audioFile);
			return {
				alignment: result.alignment,
				audioFile: cacheFile,
				provider: result.provider,
				audioDurationMs: result.audioDurationMs,
				source: 'provider',
			};
		} finally {
			release();
		}
	}

	private resolveConcurrency(config: VoiceBriefConfig, providerId: string) {
		if (providerId === 'fish') return config.providers.fish?.concurrency;
		if (providerId === 'edge') return config.providers.edge?.concurrency;
		if (providerId === 'mock') return config.providers.mock?.concurrency;
		if (providerId === 'openai') return config.providers.openai?.concurrency;
		if (providerId === 'audiocpp') return config.providers.audiocpp?.concurrency;
		return undefined;
	}

	private tryAcquireProviderSlot(providerId: string, concurrency?: number): Nullable<() => void> {
		if (concurrency === undefined) return () => undefined;
		let gate = this.$providerGates.get(providerId);
		if (!gate) {
			gate = { active: 0, limit: concurrency };
			this.$providerGates.set(providerId, gate);
		}
		gate.limit = concurrency;
		if (gate.active >= gate.limit) return undefined;
		gate.active += 1;
		return () => this.releaseProviderSlot(providerId, gate);
	}

	private releaseProviderSlot(providerId: string, gate: ProviderGate) {
		gate.active -= 1;
		if (gate.active === 0) this.$providerGates.delete(providerId);
	}

	private async removeTempFile(file: string) {
		try {
			await fs.rm(file, { force: true });
		} catch {}
	}
}

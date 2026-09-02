import { parseValue } from '../../infrastructure/schema';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { hasErrorCode } from '../../error';
import { VoiceBriefConfigInputSchema, VoiceBriefConfigSchema } from '../schema';
import type { VoiceBriefConfig, VoiceBriefConfigInput } from '../schema';
import type { VoiceBriefConfigModule } from '../index';

export class VoiceBriefConfigService {
	readonly examplePersonaFile = '默认中文助理.md';
	private $updateTail = Promise.resolve();

	constructor(readonly module: VoiceBriefConfigModule) {}

	createDefaultConfig(): VoiceBriefConfig {
		return {
			version: 1,
			enabled: true,
			provider: 'fish',
			fallbackProvider: 'edge',
			alignment: {
				enabled: false,
				provider: 'audiocpp',
				audiocpp: {
					baseUrl: 'http://127.0.0.1:8080/v1',
					language: 'zh',
					model: 'qwen3-align',
					timeoutMs: 120000,
				},
			},
			hooks: [],
			providers: {
				audiocpp: {
					baseUrl: 'http://127.0.0.1:8080/v1',
				},
				fish: {
					apiKeyEnv: 'FISH_API_KEY',
					format: 'mp3',
					model: 's2-pro',
				},
				edge: {
					voice: 'zh-CN-XiaoxiaoNeural',
					rate: '+8%',
				},
				mock: {
					outputText: true,
				},
				openai: {
					apiKeyEnv: 'OPENAI_API_KEY',
					baseUrl: 'https://api.openai.com/v1',
					format: 'mp3',
					model: 'gpt-4o-mini-tts',
					voice: 'alloy',
				},
			},
			playback: {
				command: 'auto',
				startDelayMs: 0,
				ducking: {
					enabled: true,
					attenuationDb: 24,
					restoreFadeMs: 700,
				},
			},
			cache: {
				enabled: true,
				ttlMs: 7 * 24 * 60 * 60 * 1000,
				maxEntries: 500,
				pruneIntervalMs: 60 * 60 * 1000,
			},
			throttle: {
				progressIntervalMs: 30000,
				highPriorityIntervalMs: 5000,
				networkCheckTtlMs: 60000,
			},
		};
	}

	async init(force = false) {
		const paths = await this.module.pathService.resolveVoiceBriefPaths();
		await this.module.pathService.ensureVoiceBriefDirs(paths);
		if (!force && await this.exists(paths.configFile)) {
			return {
				paths,
				config: await this.load(),
			};
		}
		const config = this.createDefaultConfig();
		await this.write(config);
		return { paths, config };
	}

	async ensure() {
		const paths = await this.module.pathService.resolveVoiceBriefPaths();
		const config = await this.load();
		await this.module.pathService.ensureVoiceBriefDirs(paths);
		try {
			await fs.access(paths.configFile);
		} catch (error) {
			if (!hasErrorCode(error, 'ENOENT')) throw error;
			await this.write(config);
		}
		return config;
	}

	async load() {
		const paths = await this.module.pathService.resolveVoiceBriefPaths();
		try {
			const text = await fs.readFile(paths.configFile, 'utf-8');
			const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
			const raw: unknown = yaml.load(text);
			let migrated = false;
			if (isRecord(raw) && isRecord(raw['playback'])) {
				if ('wait' in raw['playback']) {
					delete raw['playback']['wait'];
					migrated = true;
				}
			}
			const config = this.parseConfig(raw);
			if (migrated) await this.write(config);
			return config;
		} catch (error) {
			if (hasErrorCode(error, 'ENOENT')) return this.createDefaultConfig();
			throw error;
		}
	}

	async write(config: VoiceBriefConfig) {
		const paths = await this.module.pathService.resolveVoiceBriefPaths();
		await this.module.pathService.ensureVoiceBriefDirs(paths);
		await fs.writeFile(paths.configFile, yaml.dump(config, { lineWidth: 120 }), 'utf-8');
	}

	async setEnabled(enabled: boolean) {
		return this.update(config => {
			config.enabled = enabled;
		});
	}

	async setPlaybackStartDelayMs(startDelayMs: number) {
		return this.update(config => {
			config.playback.startDelayMs = startDelayMs;
		});
	}

	private parseConfig(raw: unknown) {
		const input = parseValue(VoiceBriefConfigInputSchema, raw === undefined ? {} : raw);
		this.validateHooks(input);
		const defaults = this.createDefaultConfig();
		const config: VoiceBriefConfig = {
			...defaults,
			...input,
			hooks: input.hooks ?? defaults.hooks,
			alignment: {
				...defaults.alignment,
				...input.alignment,
				audiocpp: { ...defaults.alignment.audiocpp, ...input.alignment?.audiocpp },
			},
			providers: {
				audiocpp: { ...defaults.providers.audiocpp, ...input.providers?.audiocpp },
				edge: { ...defaults.providers.edge, ...input.providers?.edge },
				fish: { ...defaults.providers.fish, ...input.providers?.fish },
				mock: { ...defaults.providers.mock, ...input.providers?.mock },
				openai: { ...defaults.providers.openai, ...input.providers?.openai },
			},
			playback: {
				...defaults.playback,
				...input.playback,
				ducking: {
					...defaults.playback.ducking,
					...input.playback?.ducking,
				},
			},
			cache: { ...defaults.cache, ...input.cache },
			throttle: { ...defaults.throttle, ...input.throttle },
		};
		return parseValue(VoiceBriefConfigSchema, config);
	}

	private validateHooks(config: VoiceBriefConfigInput) {
		const ids = new Set<string>();
		for (const [index, hook] of (config.hooks ?? []).entries()) {
			if (ids.has(hook.id)) throw new Error(`Hook id 重复: ${hook.id}`);
			ids.add(hook.id);
			if (hook.transport === 'unix' && !path.isAbsolute(hook.socket)) {
				throw new Error(`hooks[${index}].socket 必须是绝对路径`);
			}
		}
	}

	private async update(operation: (config: VoiceBriefConfig) => void): Promise<VoiceBriefConfig> {
		const update = this.$updateTail.then(async () => {
			const config = await this.ensure();
			operation(config);
			await this.write(config);
			return config;
		});
		this.$updateTail = update.then((): undefined => undefined, (): undefined => undefined);
		return update;
	}

	private async exists(file: string) {
		try {
			await fs.access(file);
			return true;
		} catch (error) {
			if (hasErrorCode(error, 'ENOENT')) return false;
			throw error;
		}
	}
}

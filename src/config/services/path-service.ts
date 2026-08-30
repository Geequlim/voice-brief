import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { VoiceBriefPaths } from '../types';
import type { VoiceBriefConfigModule } from '../index';

interface EnvPathsResult {
	data: string;
	config: string;
	cache: string;
	log: string;
	temp: string;
}

type EnvPathsFactory = (name: string, options?: { suffix?: string }) => EnvPathsResult;

export class VoiceBriefPathService {
	constructor(readonly module: VoiceBriefConfigModule) {}

	async resolveVoiceBriefPaths(env: NodeJS.ProcessEnv = process.env): Promise<VoiceBriefPaths> {
		const generated = await this.createEnvPaths('voice-brief');
		const homeDir = this.envPath(env, 'VOICE_BRIEF_HOME');

		let configDir = generated.config;
		let stateDir = generated.log;
		let cacheDir = generated.cache;
		let tempDir = generated.temp;
		if (homeDir) {
			configDir = homeDir;
			stateDir = path.join(homeDir, 'state');
			cacheDir = path.join(homeDir, 'cache');
			tempDir = path.join(homeDir, 'tmp');
		}

		configDir = this.envPath(env, 'VOICE_BRIEF_CONFIG_DIR') || configDir;
		stateDir = this.envPath(env, 'VOICE_BRIEF_STATE_DIR') || stateDir;
		cacheDir = this.envPath(env, 'VOICE_BRIEF_CACHE_DIR') || cacheDir;
		tempDir = this.envPath(env, 'VOICE_BRIEF_TEMP_DIR') || tempDir;

		return {
			configDir,
			configFile: path.join(configDir, 'config.yaml'),
			personaDir: path.join(configDir, 'personas'),
			stateDir,
			stateFile: path.join(stateDir, 'state.yaml'),
			cacheDir,
			tempDir,
		};
	}

	async ensureVoiceBriefDirs(paths: VoiceBriefPaths) {
		await fs.mkdir(paths.configDir, { recursive: true });
		await fs.mkdir(paths.personaDir, { recursive: true });
		await fs.mkdir(paths.stateDir, { recursive: true });
		await fs.mkdir(paths.cacheDir, { recursive: true });
		await fs.mkdir(paths.tempDir, { recursive: true });
	}

	async resolveOpenCodeConfigDir(env: NodeJS.ProcessEnv = process.env) {
		const configured = this.envPath(env, 'OPENCODE_CONFIG_DIR');
		if (configured) return configured;
		return (await this.createEnvPaths('opencode')).config;
	}

	resolveCodexHome(env: NodeJS.ProcessEnv = process.env) {
		return this.envPath(env, 'CODEX_HOME') || path.join(os.homedir(), '.codex');
	}

	resolveAgentsHome(env: NodeJS.ProcessEnv = process.env) {
		return this.envPath(env, 'AGENTS_HOME') || path.join(os.homedir(), '.agents');
	}

	resolveClaudeHome(env: NodeJS.ProcessEnv = process.env) {
		return this.envPath(env, 'CLAUDE_HOME') || path.join(os.homedir(), '.claude');
	}

	resolveCopilotHome() {
		return path.join(os.homedir(), '.copilot');
	}

	resolvePiHome(env: NodeJS.ProcessEnv = process.env) {
		return this.envPath(env, 'PI_CODING_AGENT_DIR') || path.join(os.homedir(), '.pi', 'agent');
	}

	resolveKimiCodeHome() {
		return path.join(os.homedir(), '.kimi-code');
	}

	resolveZcodeHome(env: NodeJS.ProcessEnv = process.env) {
		return this.envPath(env, 'ZCODE_HOME') || path.join(os.homedir(), '.zcode');
	}

	private async createEnvPaths(name: string) {
		const module = await import('env-paths') as { default: EnvPathsFactory };
		return module.default(name, { suffix: '' });
	}

	private envPath(env: NodeJS.ProcessEnv, key: string) {
		const value = env[key];
		if (!value) return undefined;
		return path.resolve(this.resolveHomePath(value));
	}

	private resolveHomePath(value: string) {
		if (value === '~') return os.homedir();
		if (value.startsWith(`~${path.sep}`)) return path.join(os.homedir(), value.slice(2));
		return value;
	}
}

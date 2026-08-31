import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { VoiceBriefRuntimeModule } from '../index';

export interface VoiceBriefDaemonEndpoint {
	address: string;
	directory?: string;
	recoveryFile?: string;
	socketFile?: string;
}

export class VoiceBriefDaemonEndpointService {
	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async resolve(platform: NodeJS.Platform = process.platform, tempDir = os.tmpdir(), env: NodeJS.ProcessEnv = process.env): Promise<VoiceBriefDaemonEndpoint> {
		return this.resolveForIdentity(this.userIdentity(env), platform, tempDir, env);
	}

	// 播放队列属于整个用户会话，端点必须按用户身份固定；stateDir 会随 XDG_STATE_HOME/VOICE_BRIEF_*
	// 等环境差异分裂，曾经导致多个桌面环境各起一个 daemon 并发播放
	resolveForIdentity(identity: string, platform: NodeJS.Platform = process.platform, tempDir = os.tmpdir(), env: NodeJS.ProcessEnv = {}): VoiceBriefDaemonEndpoint {
		let normalized = identity;
		if (platform === 'win32') normalized = identity.toLowerCase();
		const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 24);
		if (platform === 'win32') {
			return {
				address: `\\\\.\\pipe\\voice-brief-${hash}`,
			};
		}

		const runtimeDir = env['XDG_RUNTIME_DIR'] && path.isAbsolute(env['XDG_RUNTIME_DIR']) ? env['XDG_RUNTIME_DIR'] : undefined;
		let directory = path.join(runtimeDir ?? tempDir, `voice-brief-${hash}`);
		let socketFile = path.join(directory, 'daemon.sock');
		if (Buffer.byteLength(socketFile) > 90) {
			directory = path.join('/tmp', `voice-brief-${hash}`);
			socketFile = path.join(directory, 'daemon.sock');
		}
		return {
			address: socketFile,
			directory,
			recoveryFile: path.join(directory, 'recovery.lock'),
			socketFile,
		};
	}

	async prepare(endpoint: VoiceBriefDaemonEndpoint) {
		if (!endpoint.directory) return;
		await fs.mkdir(endpoint.directory, { recursive: true, mode: 0o700 });
		await fs.chmod(endpoint.directory, 0o700);
	}

	private userIdentity(env: NodeJS.ProcessEnv) {
		if (process.platform === 'win32') return env['USERNAME'] || env['USER'] || 'user';
		const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
		return uid === undefined ? env['USER'] || 'user' : String(uid);
	}
}

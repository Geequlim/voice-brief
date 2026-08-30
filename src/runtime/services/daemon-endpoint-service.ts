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

	async resolve(platform: NodeJS.Platform = process.platform, tempDir = os.tmpdir()): Promise<VoiceBriefDaemonEndpoint> {
		const paths = await this.module.runtimeService.getPaths();
		return this.resolveForStateDir(paths.stateDir, platform, tempDir);
	}

	resolveForStateDir(stateDir: string, platform: NodeJS.Platform = process.platform, tempDir = os.tmpdir()): VoiceBriefDaemonEndpoint {
		let identity = path.resolve(stateDir);
		if (platform === 'win32') identity = identity.toLowerCase();
		const hash = createHash('sha256').update(identity).digest('hex').slice(0, 24);
		if (platform === 'win32') {
			return {
				address: `\\\\.\\pipe\\voice-brief-${hash}`,
			};
		}

		let directory = path.join(tempDir, `voice-brief-${hash}`);
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
}

import net from 'node:net';
import type { VoiceBriefUnixHookConfig } from '../../config/schema';
import { VOICE_BRIEF_HOOK_TIMEOUT_MS } from '../types';
import type { VoiceBriefHookEvent } from '../types';
import type { VoiceBriefHookTransport } from './transport';

export class VoiceBriefUnixHookTransport implements VoiceBriefHookTransport<VoiceBriefUnixHookConfig> {
	async deliver(config: VoiceBriefUnixHookConfig, event: VoiceBriefHookEvent) {
		await new Promise<void>((resolve, reject) => {
			const socket = net.createConnection(config.socket);
			let settled = false;
			const timeout = setTimeout(() => {
				socket.destroy();
				finish(new Error(`Hook ${config.id} 写入超时`));
			}, config.timeoutMs ?? VOICE_BRIEF_HOOK_TIMEOUT_MS);
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				socket.removeListener('error', finish);
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};
			socket.once('error', finish);
			socket.once('connect', () => {
				socket.end(`${JSON.stringify(event)}\n`, () => finish());
			});
		});
	}
}

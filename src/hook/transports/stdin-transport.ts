import { spawn } from 'node:child_process';
import type { VoiceBriefStdinHookConfig } from '../../config/schema';
import { VOICE_BRIEF_HOOK_TIMEOUT_MS } from '../types';
import type { VoiceBriefHookEvent } from '../types';
import type { VoiceBriefHookTransport } from './transport';

export class VoiceBriefStdinHookTransport implements VoiceBriefHookTransport<VoiceBriefStdinHookConfig> {
	async deliver(config: VoiceBriefStdinHookConfig, event: VoiceBriefHookEvent) {
		const child = spawn(config.command, config.args || [], {
			detached: true,
			shell: false,
			stdio: ['pipe', 'ignore', 'ignore'],
		});
		const input = child.stdin;
		if (!input) throw new Error(`Hook ${config.id} 无法打开 stdin`);

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				child.kill();
				finish(new Error(`Hook ${config.id} 写入超时`));
			}, config.timeoutMs ?? VOICE_BRIEF_HOOK_TIMEOUT_MS);
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				child.removeListener('error', finish);
				input.removeListener('error', finish);
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};
			child.once('error', finish);
			input.once('error', finish);
			child.once('spawn', () => {
				input.end(`${JSON.stringify(event)}\n`, () => finish());
			});
		});
		child.unref();
	}
}

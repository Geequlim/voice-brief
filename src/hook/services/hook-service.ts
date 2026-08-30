import { randomUUID } from 'node:crypto';
import type { VoiceBriefHookConfig } from '../../config/schema';
import { VOICE_BRIEF_HOOK_PROTOCOL, VOICE_BRIEF_HOOK_PROTOCOL_VERSION } from '../types';
import type { VoiceBriefHookDeliveryResult, VoiceBriefHookDispatchResult, VoiceBriefHookEvent, VoiceBriefHookEventInput } from '../types';
import type { VoiceBriefHookModule } from '../index';

export class VoiceBriefHookService {
	constructor(readonly module: VoiceBriefHookModule) {}

	async dispatch(hooks: VoiceBriefHookConfig[], input: VoiceBriefHookEventInput): Promise<VoiceBriefHookDispatchResult> {
		const event: VoiceBriefHookEvent = {
			protocol: VOICE_BRIEF_HOOK_PROTOCOL,
			version: VOICE_BRIEF_HOOK_PROTOCOL_VERSION,
			eventId: randomUUID(),
			occurredAt: new Date().toISOString(),
			...input,
		};
		const deliveries: VoiceBriefHookDeliveryResult[] = await Promise.all(hooks.map(async hook => {
			try {
				await this.deliver(hook, event);
				return { id: hook.id, ok: true };
			} catch (error) {
				return {
					id: hook.id,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}));
		return { event, deliveries };
	}

	private deliver(config: VoiceBriefHookConfig, event: VoiceBriefHookEvent) {
		if (config.transport === 'stdin') return this.module.stdinTransport.deliver(config, event);
		return this.module.unixTransport.deliver(config, event);
	}
}

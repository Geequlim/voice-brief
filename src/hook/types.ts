import type { VoiceBriefHookEvent } from './schema';

export const VOICE_BRIEF_HOOK_TIMEOUT_MS = 1000;

export { VOICE_BRIEF_HOOK_PROTOCOL, VOICE_BRIEF_HOOK_PROTOCOL_VERSION } from './schema';
export type {
	VoiceBriefHookAudio,
	VoiceBriefHookBrief,
	VoiceBriefHookContext,
	VoiceBriefHookError,
	VoiceBriefHookEvent,
	VoiceBriefHookEventInput,
	VoiceBriefHookEventName,
	VoiceBriefHookPersona,
	VoiceBriefHookSkipReason,
	VoiceBriefHookSource,
} from './schema';

export interface VoiceBriefHookDeliveryResult {
	id: string;
	ok: boolean;
	error?: string;
}

export interface VoiceBriefHookDispatchResult {
	event: VoiceBriefHookEvent;
	deliveries: VoiceBriefHookDeliveryResult[];
}

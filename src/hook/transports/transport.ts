import type { VoiceBriefHookEvent } from '../types';

export interface VoiceBriefHookTransport<TConfig> {
	deliver(config: TConfig, event: VoiceBriefHookEvent): Promise<void>;
}


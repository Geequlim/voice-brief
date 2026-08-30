import crypto from 'node:crypto';
import type { VoiceBriefConfig, VoiceBriefState } from '../../config/schema';
import type { BriefKind, ProgressPriority, RuntimeProgressSkipResult } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';

export class VoiceBriefThrottleService {
	constructor(readonly module: VoiceBriefRuntimeModule) {}

	normalizeText(text: string, kind: BriefKind) {
		const maxChars = kind === 'progress' ? 80 : 160;
		return text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
	}

	getProgressSkipResult(state: VoiceBriefState, config: VoiceBriefConfig, brief: string, priority: ProgressPriority): RuntimeProgressSkipResult | undefined {
		const interval = priority === 'high' ? config.throttle.highPriorityIntervalMs : config.throttle.progressIntervalMs;
		if (state.lastProgressAt && this.now() - state.lastProgressAt < interval) {
			const hash = this.textHash(brief);
			if (state.lastProgressHash === hash) {
				return {
					status: 'skipped',
					message: '重复进度提示已跳过',
					reason: 'duplicate',
				};
			}
			return {
				status: 'skipped',
				message: '进度提示节流中，已跳过',
				reason: 'throttled',
			};
		}

		return undefined;
	}

	applyProgressState(state: VoiceBriefState, brief: string) {
		state.lastProgressHash = this.textHash(brief);
		state.lastProgressAt = this.now();
	}

	applyFinalState(state: VoiceBriefState) {
		state.lastFinalAt = this.now();
	}

	private textHash(text: string) {
		return crypto.createHash('sha256').update(text).digest('hex');
	}

	private now() {
		return Date.now();
	}
}

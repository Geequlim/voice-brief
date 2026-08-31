import crypto from 'node:crypto';
import type { VoiceBriefConfig, VoiceBriefState } from '../../config/schema';
import type { BriefKind, ProgressPriority, RuntimeNormalizedBrief, RuntimeProgressSkipResult } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';

const SENTENCE_TERMINATOR = /[。！？；…!?]/;

export class VoiceBriefThrottleService {
	constructor(readonly module: VoiceBriefRuntimeModule) {}

	normalizeText(text: string, kind: BriefKind): RuntimeNormalizedBrief {
		const brief = text.replace(/\s+/g, ' ').trim();
		const chars = Array.from(brief);
		const limitChars = kind === 'progress' ? 80 : 160;
		if (chars.length <= limitChars) {
			return { text: brief, kind, limitChars, originalChars: chars.length, adjusted: false, boundary: true };
		}
		const boundaryIndex = chars.findIndex((char, index) => index >= limitChars - 1 && SENTENCE_TERMINATOR.test(char));
		if (boundaryIndex === -1) {
			return { text: brief, kind, limitChars, originalChars: chars.length, adjusted: true, boundary: false };
		}
		return {
			text: chars.slice(0, boundaryIndex + 1).join(''),
			kind,
			limitChars,
			originalChars: chars.length,
			adjusted: true,
			boundary: true,
		};
	}

	formatAdjustmentWarning(brief: RuntimeNormalizedBrief) {
		const label = brief.kind === 'progress' ? '过程播报' : '最终简报';
		const spokenChars = Array.from(brief.text).length;
		const ending = brief.boundary ? `已在句子边界收尾播报（本次 ${spokenChars} 字）` : `未找到句子边界，已完整播报（本次 ${spokenChars} 字）`;
		return `${label}文本共 ${brief.originalChars} 字，超出 ${brief.limitChars} 字上限，${ending}。下次请把${label}控制在 ${brief.limitChars} 字以内。`;
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

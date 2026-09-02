type HookEventName =
	| 'brief.skipped'
	| 'audio.preparing'
	| 'audio.ready'
	| 'audio.alignment.ready'
	| 'audio.failed'
	| 'playback.queued'
	| 'playback.ready'
	| 'playback.started'
	| 'playback.completed'
	| 'playback.failed'
	| 'playback.skipped';
type BriefKind = 'final' | 'progress' | 'test';
type BriefPriority = 'normal' | 'high';
type AudioSource = 'cache' | 'provider';
type SkipReason = 'disabled' | 'duplicate' | 'empty_text' | 'player_disabled' | 'throttled';

interface VoiceBriefHookEvent {
	protocol: 'voice-brief.hook-event';
	version: 2;
	eventId: string;
	occurredAt: string;
	briefId: string;
	event: HookEventName;
	sequence: number;
	brief: {
		text: string;
		kind: BriefKind;
		priority: BriefPriority;
	};
	source?: {
		agent?: string;
		model?: string;
		session?: string;
	};
	persona?: {
		name: string;
		avatar?: string;
		color?: string;
	};
	audio?: {
		alignment?: {
			source: string;
			cues: Array<{
				text: string;
				startMs: number;
				endMs: number;
				startChar: number;
				endChar: number;
			}>;
		};
		provider: string;
		source: AudioSource;
		durationMs?: number;
	};
	error?: {
		stage: string;
		message: string;
	};
	reason?: SkipReason;
}

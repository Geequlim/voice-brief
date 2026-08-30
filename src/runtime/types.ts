import type { VoiceBriefConfig } from '../config/schema';
import type { VoiceBriefPaths } from '../config/types';
import type { VoiceBriefHookAudio, VoiceBriefHookBrief, VoiceBriefHookContext, VoiceBriefHookSkipReason } from '../hook/schema';
import type { VoicePersona } from '../persona/types';

export const VOICE_BRIEF_DAEMON_ARGUMENT = '--voice-brief-daemon';

export type BriefKind = VoiceBriefHookBrief['kind'];

export type ProgressPriority = VoiceBriefHookBrief['priority'];

export interface SynthesizeInput {
	text: string;
	kind: BriefKind;
	persona?: VoicePersona;
	config: VoiceBriefConfig;
	paths: VoiceBriefPaths;
}

export interface ProviderCacheDescriptor {
	extension: string;
	keyData: Record<string, unknown>;
}

export interface SynthesizeResult {
	audioFile: string;
	provider: string;
	audioDurationMs?: number;
}

export interface PreparedAudioResult extends SynthesizeResult {
	source: 'cache' | 'provider';
}

export interface ProviderSynthesisTask {
	provider: string;
	source: PreparedAudioResult['source'];
	result: Promise<PreparedAudioResult>;
}

export interface ProviderCheckResult {
	ok: boolean;
	message: string;
}

export interface TtsProvider {
	readonly id: string;
	check(config: VoiceBriefConfig): Promise<ProviderCheckResult>;
	getCacheDescriptor(input: SynthesizeInput): ProviderCacheDescriptor;
	synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
}

export interface PlayerCheckResult {
	ok: boolean;
	command?: string;
	message: string;
}

export interface DuckingCheckResult {
	available: boolean;
	enabled: boolean;
	message: string;
}

export interface RuntimeProgressSkipResult {
	status: 'skipped';
	message: string;
	reason: 'duplicate' | 'throttled';
}

export interface SpeakTextOptions {
	agent?: string;
	model?: string;
	personaName?: string;
	priority?: ProgressPriority;
	session?: string;
}

export interface DaemonHealthResult {
	pid: number;
	version: string;
}

export interface DaemonSubmitRequest {
	kind: BriefKind;
	text: string;
	options?: SpeakTextOptions;
}

export type DaemonSubmitResult =
	| { status: 'cached'; requestId: string; provider: string; }
	| { status: 'synthesizing'; requestId: string; provider: string; }
	| { status: 'skipped'; requestId: string; reason: RuntimeAdmissionSkipReason; }
	| { status: 'rejected'; requestId: string; reason: 'capacity'; provider: string; };

export interface DaemonShutdownResult {
	accepted: true;
}

export interface DaemonRuntimeConfigInput {
	playbackStartDelayMs: number;
}

export type DaemonRuntimeConfigResult = DaemonRuntimeConfigInput;

export interface VoiceBriefDaemonApi {
	configureRuntime(input: DaemonRuntimeConfigInput): Promise<DaemonRuntimeConfigResult>;
	health(): Promise<DaemonHealthResult>;
	shutdown(): Promise<DaemonShutdownResult>;
	submit(request: DaemonSubmitRequest): Promise<DaemonSubmitResult>;
}

export interface RuntimeSpeechTask {
	brief: string;
	config: VoiceBriefConfig;
	eventContext: VoiceBriefHookContext;
	kind: BriefKind;
	paths: VoiceBriefPaths;
	sequence: number;
}

export type RuntimeAdmissionSkipReason = Exclude<VoiceBriefHookSkipReason, 'player_disabled'>;

export type RuntimeSpeechAdmission =
	| { status: 'admitted'; speech: RuntimeSpeechTask; }
	| { status: 'skipped'; reason: RuntimeAdmissionSkipReason; };

export interface RuntimeSpeechStart {
	provider: string;
	status: 'cached' | 'synthesizing';
	completion: Promise<PreparedSpeechTask | undefined>;
}

export interface PreparedSpeechTask extends RuntimeSpeechTask {
	audio: VoiceBriefHookAudio;
	persona?: VoicePersona;
	result: PreparedAudioResult;
	volume?: number;
}

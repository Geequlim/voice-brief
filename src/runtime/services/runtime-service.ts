import path from 'node:path';
import { VoiceBriefConfigModule } from '../../config';
import { errorMessage } from '../../error';
import { VoiceBriefHookModule } from '../../hook';
import type { VoiceBriefHookAudio, VoiceBriefHookEventName, VoiceBriefHookSkipReason } from '../../hook/types';
import { VoiceBriefPersonaModule } from '../../persona';
import type { VoicePersona } from '../../persona/types';
import type { VoiceBriefConfig } from '../../config/schema';
import type { DaemonSubmitRequest, PreparedAudioResult, PreparedSpeechTask, RuntimeSpeechAdmission, RuntimeSpeechStart, RuntimeSpeechTask } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';
import { VoiceBriefPlaybackStoppedError } from './playback-service';

interface HookEventDetails {
	audio?: VoiceBriefHookAudio;
	error?: {
		stage: string;
		message: string;
	};
	reason?: VoiceBriefHookSkipReason;
}

interface ActivePlayback {
	alignmentDelivery?: Promise<void>;
	phase: 'activating' | 'preparing' | 'playing';
	task: PreparedSpeechTask;
}

export class VoiceBriefRuntimeService {
	private $stopping = false;
	private $activePlayback?: ActivePlayback;
	private readonly $playbackDelayResolvers = new Set<() => void>();

	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async getPaths() {
		return this.getConfigModule().pathService.resolveVoiceBriefPaths();
	}

	async admitSpeech(requestId: string, request: DaemonSubmitRequest): Promise<RuntimeSpeechAdmission> {
		const paths = await this.getPaths();
		const configModule = this.getConfigModule();
		await configModule.pathService.ensureVoiceBriefDirs(paths);
		const config = await configModule.configService.ensure();
		const normalized = this.module.throttleService.normalizeText(request.text, request.kind);
		const brief = normalized.text;
		const priority = request.options?.priority || 'normal';
		const source = request.options?.agent || request.options?.model || request.options?.session
			? { agent: request.options?.agent, model: request.options?.model, session: request.options?.session }
			: undefined;
		const task: RuntimeSpeechTask = {
			brief,
			config,
			eventContext: {
				briefId: requestId,
				brief: { text: brief, kind: request.kind, priority },
				source,
			},
			kind: request.kind,
			paths,
			sequence: 0,
		};

		if (!brief) {
			await this.emitHook(task, 'brief.skipped', { reason: 'empty_text' });
			return { status: 'skipped', reason: 'empty_text' };
		}
		if (!config.enabled) {
			await this.emitHook(task, 'brief.skipped', { reason: 'disabled' });
			return { status: 'skipped', reason: 'disabled' };
		}

		const skipped = await configModule.stateService.update(async state => {
			await this.module.cacheService.pruneIfNeeded(paths, config, state);
			if (request.kind === 'progress') {
				const result = this.module.throttleService.getProgressSkipResult(state, config, brief, priority);
				if (result) return result;
				this.module.throttleService.applyProgressState(state, brief);
			}
			if (request.kind === 'final') this.module.throttleService.applyFinalState(state);
			return undefined;
		});
		if (skipped) {
			await this.emitHook(task, 'brief.skipped', { reason: skipped.reason });
			return { status: 'skipped', reason: skipped.reason };
		}
		return {
			status: 'admitted',
			speech: task,
			warning: normalized.adjusted ? this.module.throttleService.formatAdjustmentWarning(normalized) : undefined,
		};
	}

	async startSpeech(task: RuntimeSpeechTask, options?: DaemonSubmitRequest['options']): Promise<RuntimeSpeechStart> {
		let stage = 'persona';
		let persona: VoicePersona | undefined;
		try {
			persona = await this.loadPersona(options?.personaName);
			if (persona) {
				task.eventContext = {
					...task.eventContext,
					persona: {
						name: persona.name,
						avatar: persona.avatar ? path.resolve(task.paths.personaDir, persona.avatar) : undefined,
						color: persona.color,
					},
				};
			}
			stage = 'synthesis';
			const synthesis = await this.module.providerService.startSynthesisWithFallback(task.paths, task.config, persona, task.kind, task.brief);
			return {
				provider: synthesis.provider,
				status: synthesis.source === 'cache' ? 'cached' : 'synthesizing',
				completion: this.completeSpeech(task, persona, synthesis.result),
			};
		} catch (error) {
			await this.failSpeech(task, stage, error);
			throw error;
		}
	}

	private async completeSpeech(task: RuntimeSpeechTask, persona: VoicePersona | undefined, resultPromise: Promise<PreparedAudioResult>): Promise<PreparedSpeechTask | undefined> {
		let stage = 'synthesis';
		try {
			await this.emitHook(task, 'audio.preparing');
			const result = await resultPromise;
			const audio: VoiceBriefHookAudio = {
				provider: result.provider,
				source: result.source,
			};
			const prepared: PreparedSpeechTask = {
				...task,
				audio,
				persona,
				result,
				volume: this.resolveVolume(result.provider, task.config, persona),
			};
			prepared.alignmentTask = this.module.alignmentService.start(prepared);
			if (prepared.alignmentTask) {
				void prepared.alignmentTask.completion.then(() => this.onAlignmentReady(prepared));
			}
			stage = 'metadata';
			audio.durationMs = result.audioDurationMs ?? await this.module.audioMetadataService.getAudioDurationMs(result.audioFile);
			await this.getConfigModule().stateService.update(state => {
				state.lastProviderError = undefined;
			});
			await this.emitHook(prepared, 'audio.ready', { audio });
			return prepared;
		} catch (error) {
			await this.failSpeech(task, stage, error);
			return undefined;
		}
	}

	private async failSpeech(task: RuntimeSpeechTask, stage: string, error: unknown) {
		const message = errorMessage(error, 'unknown audio preparation error');
		await this.emitHook(task, 'audio.failed', { error: { stage, message } });
		await this.getConfigModule().stateService.update(state => {
			state.lastProviderError = message;
		});
	}

	async queueSpeech(task: PreparedSpeechTask) {
		await this.emitHook(task, 'playback.queued', { audio: task.audio });
	}

	async playSpeech(task: PreparedSpeechTask) {
		if (this.module.playbackService.isDisabled(task.config)) {
			await this.emitHook(task, 'playback.skipped', { audio: task.audio, reason: 'player_disabled' });
			return;
		}

		this.$activePlayback = { phase: 'activating', task };
		const readyAudio = this.audioWithAvailableAlignment(task);
		await this.emitHook(task, 'playback.ready', { audio: readyAudio });
		const active = this.activePlaybackFor(task);
		if (!active) return;
		active.phase = 'preparing';
		this.flushAlignment(task);
		await this.waitForPlayback(task.config.playback.startDelayMs);
		if (this.$stopping) {
			await this.finishActivePlayback(task);
			return;
		}
		try {
			await this.module.playbackService.playAudioFile(task.paths, task.config, task.result.audioFile, task.volume, async () => {
				await this.emitHook(task, 'playback.started', { audio: task.audio });
				const current = this.activePlaybackFor(task);
				if (current) current.phase = 'playing';
			});
			await this.finishActivePlayback(task);
			await this.emitHook(task, 'playback.completed', { audio: task.audio });
			await this.getConfigModule().stateService.update(state => {
				state.lastPlaybackError = undefined;
			});
		} catch (error) {
			await this.finishActivePlayback(task);
			if (error instanceof VoiceBriefPlaybackStoppedError) return;
			const message = errorMessage(error, 'unknown playback error');
			await this.emitHook(task, 'playback.failed', { audio: task.audio, error: { stage: 'playback', message } });
			await this.getConfigModule().stateService.update(state => {
				state.lastPlaybackError = message;
			});
		}
	}

	stop() {
		this.$stopping = true;
		this.$activePlayback = undefined;
		for (const resolve of this.$playbackDelayResolvers) resolve();
		this.$playbackDelayResolvers.clear();
	}

	async loadStatus() {
		const paths = await this.getPaths();
		const configModule = this.getConfigModule();
		const config = await configModule.configService.ensure();
		const state = await configModule.stateService.load();
		return {
			paths,
			config,
			state,
		};
	}

	async runDoctor() {
		const status = await this.loadStatus();
		return {
			...status,
			ducking: await this.module.duckingService.check(status.config),
			player: this.module.playbackService.check(status.config),
			providers: await this.module.providerService.checkAll(status.config),
		};
	}

	private async emitHook(task: RuntimeSpeechTask, event: VoiceBriefHookEventName, details?: HookEventDetails) {
		task.sequence += 1;
		await this.getHookModule().hookService.dispatch(task.config.hooks, {
			...task.eventContext,
			event,
			sequence: task.sequence,
			...details,
		});
	}

	private onAlignmentReady(task: PreparedSpeechTask) {
		if (!task.alignmentTask?.result || task.alignmentTask.delivered) return;
		this.flushAlignment(task);
	}

	private flushAlignment(task: PreparedSpeechTask) {
		const active = this.activePlaybackFor(task);
		const alignmentTask = task.alignmentTask;
		if (!active || active.phase === 'activating' || !alignmentTask?.result || alignmentTask.delivered) return;
		alignmentTask.delivered = true;
		const delivery = this.emitHook(task, 'audio.alignment.ready', {
			audio: { ...task.audio, alignment: alignmentTask.result },
		}).catch((): undefined => undefined);
		active.alignmentDelivery = delivery;
	}

	private audioWithAvailableAlignment(task: PreparedSpeechTask) {
		const alignmentTask = task.alignmentTask;
		if (!alignmentTask?.result || alignmentTask.delivered) return task.audio;
		alignmentTask.delivered = true;
		return { ...task.audio, alignment: alignmentTask.result };
	}

	private activePlaybackFor(task: PreparedSpeechTask) {
		return this.$activePlayback?.task.eventContext.briefId === task.eventContext.briefId ? this.$activePlayback : undefined;
	}

	private async finishActivePlayback(task: PreparedSpeechTask) {
		const active = this.activePlaybackFor(task);
		if (!active) return;
		this.$activePlayback = undefined;
		await active.alignmentDelivery;
	}

	private async waitForPlayback(durationMs: number) {
		if (durationMs === 0 || this.$stopping) return;
		await new Promise<void>(resolve => {
			const complete = () => {
				clearTimeout(timeout);
				this.$playbackDelayResolvers.delete(complete);
				resolve();
			};
			const timeout = setTimeout(complete, durationMs);
			this.$playbackDelayResolvers.add(complete);
		});
	}

	private resolveVolume(provider: string, config: VoiceBriefConfig, persona?: VoicePersona): number | undefined {
		if (provider === 'fish') return persona?.fish?.volume ?? config.providers.fish?.volume;
		if (provider === 'edge') return persona?.edge?.volume ?? config.providers.edge?.volume;
		if (provider === 'openai') return persona?.openai?.volume ?? config.providers.openai?.volume;
		if (provider === 'audiocpp') return persona?.audiocpp?.volume ?? config.providers.audiocpp?.volume;
		return undefined;
	}

	private getConfigModule() {
		return this.module.app.getModule(VoiceBriefConfigModule);
	}

	private getHookModule() {
		return this.module.app.getModule(VoiceBriefHookModule);
	}

	private getPersonaModule() {
		return this.module.app.getModule(VoiceBriefPersonaModule);
	}

	private async loadPersona(personaName?: string) {
		if (!personaName) return undefined;
		return this.getPersonaModule().personaService.load(personaName);
	}
}

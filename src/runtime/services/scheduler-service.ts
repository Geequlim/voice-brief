import type { DaemonSubmitRequest, DaemonSubmitResult, PreparedSpeechTask } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';
import { VoiceBriefProviderBusyError } from './provider-service';

type SchedulerTaskState = 'accepted' | 'admitting' | 'synthesizing' | 'ready' | 'playing';

interface SchedulerTask {
	id: string;
	request: DaemonSubmitRequest;
	state: SchedulerTaskState;
}

interface ReadyTask {
	id: string;
	speech: PreparedSpeechTask;
}

export class VoiceBriefSchedulerService {
	private $accepting = true;
	private $admissionTail = Promise.resolve();
	private $playLoop?: Promise<void>;
	private readonly $readyTasks: ReadyTask[] = [];
	private readonly $tasks = new Map<string, SchedulerTask>();

	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async submit(id: string, request: DaemonSubmitRequest): Promise<DaemonSubmitResult> {
		if (!this.$accepting) throw new Error('voice-brief daemon 正在停止');
		const task: SchedulerTask = { id, request, state: 'accepted' };
		this.$tasks.set(id, task);
		const admission = this.$admissionTail.then(() => this.admit(task));
		this.$admissionTail = admission.then((): undefined => undefined, (): undefined => undefined);
		return admission;
	}

	async stop() {
		this.$accepting = false;
		this.$readyTasks.length = 0;
		this.module.runtimeService.stop();
		await this.module.playbackService.stop();
		await this.$admissionTail;
		try {
			await this.$playLoop;
		} catch {}
		this.$tasks.clear();
	}

	private async admit(task: SchedulerTask): Promise<DaemonSubmitResult> {
		if (!this.$accepting) {
			this.$tasks.delete(task.id);
			throw new Error('voice-brief daemon 正在停止');
		}
		task.state = 'admitting';
		try {
			const admission = await this.module.runtimeService.admitSpeech(task.id, task.request);
			if (admission.status === 'skipped') {
				this.$tasks.delete(task.id);
				return { status: 'skipped', requestId: task.id, reason: admission.reason };
			}
			if (!this.$accepting) throw new Error('voice-brief daemon 正在停止');
			const start = await this.module.runtimeService.startSpeech(admission.speech, task.request.options);
			task.state = 'synthesizing';
			void this.complete(task, start.completion);
			return { status: start.status, requestId: task.id, provider: start.provider, warning: admission.warning };
		} catch (error) {
			this.$tasks.delete(task.id);
			if (error instanceof VoiceBriefProviderBusyError) {
				return { status: 'rejected', requestId: task.id, reason: 'capacity', provider: error.providerId };
			}
			throw error;
		}
	}

	private async complete(task: SchedulerTask, completion: Promise<PreparedSpeechTask | undefined>) {
		let prepared: PreparedSpeechTask | undefined;
		try {
			prepared = await completion;
		} catch {
			this.$tasks.delete(task.id);
			return;
		}
		if (!prepared || !this.$accepting) {
			this.$tasks.delete(task.id);
			return;
		}
		task.state = 'ready';
		this.$readyTasks.push({ id: task.id, speech: prepared });
		await this.module.runtimeService.queueSpeech(prepared);
		if (!this.$accepting) return;
		this.startPlayLoop();
	}

	private startPlayLoop() {
		if (this.$playLoop || !this.$accepting) return;
		const loop = this.playReadyTasks();
		this.$playLoop = loop.finally(() => {
			this.$playLoop = undefined;
			if (this.$readyTasks.length > 0) this.startPlayLoop();
		});
	}

	private async playReadyTasks() {
		while (this.$accepting && this.$readyTasks.length > 0) {
			const ready = this.$readyTasks.shift();
			if (!ready) continue;
			const task = this.$tasks.get(ready.id);
			if (!task) continue;
			task.state = 'playing';
			try {
				await this.module.runtimeService.playSpeech(ready.speech);
			} catch {
				// runtime 负责记录具体错误，调度器继续驱动后续 ready 任务。
			} finally {
				this.$tasks.delete(ready.id);
			}
		}
	}
}

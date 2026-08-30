import { describe, expect, test, vi } from 'vitest';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import type { PreparedSpeechTask, RuntimeSpeechTask } from '../src/runtime/types';
import { VoiceBriefProviderBusyError } from '../src/runtime/services/provider-service';
import { VoiceBriefSchedulerService } from '../src/runtime/services/scheduler-service';

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

describe('VoiceBriefSchedulerService', () => {
	test('合成任务相互独立，谁先 ready 谁先播放', async () => {
		const slow = deferred<PreparedSpeechTask | undefined>();
		const fast = deferred<PreparedSpeechTask | undefined>();
		const played: string[] = [];
		const module = createModule({
			startSpeech: vi.fn(async (speech: RuntimeSpeechTask) => ({
				provider: 'mock',
				status: 'synthesizing',
				completion: speech.brief === 'slow' ? slow.promise : fast.promise,
			})),
			playSpeech: vi.fn(async (speech: PreparedSpeechTask) => {
				played.push(speech.brief);
			}),
		});
		const scheduler = new VoiceBriefSchedulerService(module);

		await expect(scheduler.submit('slow-id', { kind: 'final', text: 'slow' })).resolves.toMatchObject({ status: 'synthesizing', provider: 'mock' });
		await expect(scheduler.submit('fast-id', { kind: 'final', text: 'fast' })).resolves.toMatchObject({ status: 'synthesizing', provider: 'mock' });
		expect(module.runtimeService.startSpeech).toHaveBeenCalledTimes(2);
		fast.resolve(createPrepared('fast-id', 'fast'));
		await vi.waitFor(() => expect(played).toEqual(['fast']));
		slow.resolve(createPrepared('slow-id', 'slow'));
		await vi.waitFor(() => expect(played).toEqual(['fast', 'slow']));
	});

	test('ready 队列始终只播放一个任务', async () => {
		const firstPlayback = deferred<void>();
		const played: string[] = [];
		const module = createModule({
			startSpeech: vi.fn(async (speech: RuntimeSpeechTask) => ({
				provider: 'mock',
				status: 'synthesizing',
				completion: Promise.resolve(createPrepared(speech.eventContext.briefId, speech.brief)),
			})),
			playSpeech: vi.fn(async (speech: PreparedSpeechTask) => {
				played.push(speech.brief);
				if (speech.brief === 'first') await firstPlayback.promise;
			}),
		});
		const scheduler = new VoiceBriefSchedulerService(module);

		await scheduler.submit('first-id', { kind: 'final', text: 'first' });
		await scheduler.submit('second-id', { kind: 'final', text: 'second' });
		await vi.waitFor(() => expect(played).toEqual(['first']));
		firstPlayback.resolve();
		await vi.waitFor(() => expect(played).toEqual(['first', 'second']));
	});

	test('停止后拒绝新任务并停止当前播放器', async () => {
		const stop = vi.fn().mockResolvedValue(undefined);
		const module = createModule({ stop });
		const scheduler = new VoiceBriefSchedulerService(module);

		await scheduler.stop();

		await expect(scheduler.submit('late-id', { kind: 'final', text: 'late' })).rejects.toThrow('正在停止');
		expect(stop).toHaveBeenCalledOnce();
		expect(module.runtimeService.stop).toHaveBeenCalledOnce();
	});

	test('返回缓存命中、跳过和容量不足的明确准入结果', async () => {
		const cachedModule = createModule({
			startSpeech: vi.fn(async (speech: RuntimeSpeechTask) => ({
				provider: 'mock',
				status: 'cached',
				completion: Promise.resolve(createPrepared(speech.eventContext.briefId, speech.brief)),
			})),
		});
		const cachedScheduler = new VoiceBriefSchedulerService(cachedModule);
		await expect(cachedScheduler.submit('cached-id', { kind: 'final', text: 'cached' })).resolves.toEqual({
			status: 'cached',
			requestId: 'cached-id',
			provider: 'mock',
		});

		const skippedModule = createModule({
			admitSpeech: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'throttled' }),
		});
		const skippedScheduler = new VoiceBriefSchedulerService(skippedModule);
		await expect(skippedScheduler.submit('skipped-id', { kind: 'progress', text: 'skipped' })).resolves.toEqual({
			status: 'skipped',
			requestId: 'skipped-id',
			reason: 'throttled',
		});

		const busyModule = createModule({
			startSpeech: vi.fn().mockRejectedValue(new VoiceBriefProviderBusyError('edge')),
		});
		const busyScheduler = new VoiceBriefSchedulerService(busyModule);
		await expect(busyScheduler.submit('busy-id', { kind: 'final', text: 'busy' })).resolves.toEqual({
			status: 'rejected',
			requestId: 'busy-id',
			reason: 'capacity',
			provider: 'edge',
		});
	});

	function createModule(overrides?: {
		admitSpeech?: ReturnType<typeof vi.fn>;
		playSpeech?: ReturnType<typeof vi.fn>;
		startSpeech?: ReturnType<typeof vi.fn>;
		stop?: ReturnType<typeof vi.fn>;
	}) {
		const runtimeService = {
			admitSpeech: overrides?.admitSpeech || vi.fn(async (id: string, request: { text: string; }) => ({ status: 'admitted', speech: createSpeech(id, request.text) })),
			startSpeech: overrides?.startSpeech || vi.fn(async (speech: RuntimeSpeechTask) => ({
				provider: 'mock',
				status: 'synthesizing',
				completion: Promise.resolve(createPrepared(speech.eventContext.briefId, speech.brief)),
			})),
			playSpeech: overrides?.playSpeech || vi.fn().mockResolvedValue(undefined),
			queueSpeech: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		return {
			playbackService: {
				stop: overrides?.stop || vi.fn().mockResolvedValue(undefined),
			},
			runtimeService,
		} as unknown as VoiceBriefRuntimeModule;
	}

	function createSpeech(id: string, text: string): RuntimeSpeechTask {
		return {
			brief: text,
			config: {} as RuntimeSpeechTask['config'],
			eventContext: {
				briefId: id,
				brief: { text, kind: 'final', priority: 'normal' },
			},
			kind: 'final',
			paths: {} as RuntimeSpeechTask['paths'],
			sequence: 0,
		};
	}

	function createPrepared(id: string, text: string): PreparedSpeechTask {
		return {
			...createSpeech(id, text),
			audio: { provider: 'mock', source: 'provider' },
			result: { audioFile: `/tmp/${id}.mp3`, provider: 'mock', source: 'provider' },
		};
	}

	function deferred<T>(): Deferred<T> {
		let resolvePromise: (value: T) => void = () => undefined;
		const promise = new Promise<T>(resolve => {
			resolvePromise = resolve;
		});
		return { promise, resolve: resolvePromise };
	}
});

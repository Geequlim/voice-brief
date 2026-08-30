import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import type {
	DaemonRuntimeConfigInput,
	DaemonRuntimeConfigResult,
	VoiceBriefDaemonApi,
} from '../src/runtime/types';
import { VoiceBriefDaemonClientService } from '../src/runtime/services/daemon-client-service';

interface TestConnection {
	api: VoiceBriefDaemonApi;
	close(): void;
}

interface TestableDaemonClient {
	connect(): Promise<TestConnection>;
	startDaemon(): Promise<void>;
	waitForDaemon(): Promise<TestConnection>;
	waitForStop(): Promise<void>;
}

describe('VoiceBrief daemon client', () => {
	beforeEach(() => {
		vi.stubGlobal('VERSION', { name: '0.2.1' });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test('daemon 不存在时启动当前版本后提交', async () => {
		const service = new VoiceBriefDaemonClientService({} as VoiceBriefRuntimeModule);
		const internals = service as unknown as TestableDaemonClient;
		const current = createConnection('0.2.1');
		vi.spyOn(internals, 'connect').mockRejectedValue(new Error('ENOENT'));
		const startDaemon = vi.spyOn(internals, 'startDaemon').mockResolvedValue(undefined);
		vi.spyOn(internals, 'waitForDaemon').mockResolvedValue(current.connection);

		await expect(service.submit({ kind: 'final', text: '任务完成' })).resolves.toMatchObject({ status: 'synthesizing' });
		expect(startDaemon).toHaveBeenCalledOnce();
		expect(current.submit).toHaveBeenCalledWith({ kind: 'final', text: '任务完成' });
		expect(current.close).toHaveBeenCalledOnce();
	});

	test('版本不一致时关闭旧 daemon 并切换到当前版本', async () => {
		const service = new VoiceBriefDaemonClientService({} as VoiceBriefRuntimeModule);
		const internals = service as unknown as TestableDaemonClient;
		const old = createConnection('0.1.0');
		const current = createConnection('0.2.1');
		vi.spyOn(internals, 'connect').mockResolvedValue(old.connection);
		const waitForStop = vi.spyOn(internals, 'waitForStop').mockResolvedValue(undefined);
		const startDaemon = vi.spyOn(internals, 'startDaemon').mockResolvedValue(undefined);
		vi.spyOn(internals, 'waitForDaemon').mockResolvedValue(current.connection);

		await expect(service.submit({ kind: 'progress', text: '处理中' })).resolves.toMatchObject({ status: 'synthesizing' });
		expect(old.shutdown).toHaveBeenCalledOnce();
		expect(old.close).toHaveBeenCalledOnce();
		expect(waitForStop).toHaveBeenCalledOnce();
		expect(startDaemon).toHaveBeenCalledOnce();
		expect(current.submit).toHaveBeenCalledWith({ kind: 'progress', text: '处理中' });
	});

	test('通过当前 daemon 调整运行配置并关闭连接', async () => {
		const service = new VoiceBriefDaemonClientService({} as VoiceBriefRuntimeModule);
		const internals = service as unknown as TestableDaemonClient;
		const current = createConnection('0.2.1');
		vi.spyOn(internals, 'connect').mockResolvedValue(current.connection);

		await expect(service.configureRuntime({ playbackStartDelayMs: 1150 })).resolves.toEqual({
			playbackStartDelayMs: 1150,
		});
		expect(current.configureRuntime).toHaveBeenCalledWith({ playbackStartDelayMs: 1150 });
		expect(current.close).toHaveBeenCalledOnce();
	});

	function createConnection(version: string) {
		const close = vi.fn();
		const configureRuntime = vi.fn(
			async (input: DaemonRuntimeConfigInput): Promise<DaemonRuntimeConfigResult> => input,
		);
		const submit = vi.fn().mockResolvedValue({ status: 'synthesizing', requestId: `request-${version}`, provider: 'mock' });
		const shutdown = vi.fn().mockResolvedValue({ accepted: true });
		const api: VoiceBriefDaemonApi = {
			configureRuntime,
			health: vi.fn().mockResolvedValue({ pid: 100, version }),
			shutdown,
			submit,
		};
		return {
			close,
			connection: { api, close },
			configureRuntime,
			shutdown,
			submit,
		};
	}
});

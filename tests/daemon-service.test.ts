import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { RPCChannel } from 'kkrpc';
import { nodeStdioTransport } from 'kkrpc/stdio';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import type { VoiceBriefDaemonApi } from '../src/runtime/types';
import type { VoiceBriefDaemonEndpoint } from '../src/runtime/services/daemon-endpoint-service';
import { VoiceBriefDaemonService } from '../src/runtime/services/daemon-service';

interface TestClient {
	api: VoiceBriefDaemonApi;
	close(): void;
}

describe('VoiceBrief daemon service', () => {
	let endpoint: VoiceBriefDaemonEndpoint;
	let rootDir: string;
	let schedulerSubmit: ReturnType<typeof vi.fn>;
	let schedulerStop: ReturnType<typeof vi.fn>;
	let setPlaybackStartDelayMs: ReturnType<typeof vi.fn>;
	let service: VoiceBriefDaemonService;

	beforeEach(async () => {
		vi.stubGlobal('VERSION', { name: '0.2.1' });
		rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-daemon-'));
		endpoint = {
			address: path.join(rootDir, 'daemon.sock'),
			directory: rootDir,
			recoveryFile: path.join(rootDir, 'recovery.lock'),
			socketFile: path.join(rootDir, 'daemon.sock'),
		};
		schedulerSubmit = vi.fn().mockResolvedValue({ status: 'synthesizing', requestId: 'request-1', provider: 'mock' });
		schedulerStop = vi.fn().mockResolvedValue(undefined);
		setPlaybackStartDelayMs = vi.fn(async (startDelayMs: number) => ({ playback: { startDelayMs } }));
		service = createService();
	});

	afterEach(async () => {
		await service.stop();
		await fs.rm(rootDir, { recursive: true, force: true });
		vi.unstubAllGlobals();
	});

	test('通过本地 socket 提供 health 并返回合成准入结果', async () => {
		expect(await service.start()).toBe(true);
		const client = await connect();
		try {
			await expect(client.api.health()).resolves.toEqual({ pid: process.pid, version: '0.2.1' });
			await expect(client.api.submit({
				kind: 'final',
				text: '任务完成',
				options: { agent: 'codex' },
			})).resolves.toMatchObject({ status: 'synthesizing', provider: 'mock' });
			expect(schedulerSubmit).toHaveBeenCalledWith(expect.any(String), {
				kind: 'final',
				text: '任务完成',
				options: { agent: 'codex' },
			});
		} finally {
			client.close();
		}
	});

	test('Unix 残留 socket 会在恢复租约保护下重建', async () => {
		await fs.writeFile(endpoint.address, 'stale', 'utf-8');

		await expect(service.start()).resolves.toBe(true);
		const client = await connect();
		try {
			await expect(client.api.health()).resolves.toMatchObject({ version: '0.2.1' });
		} finally {
			client.close();
		}
	});

	test('通过 daemon 接口校验并写入播放启动延迟', async () => {
		expect(await service.start()).toBe(true);
		const client = await connect();
		try {
			await expect(client.api.configureRuntime({ playbackStartDelayMs: 1150 })).resolves.toEqual({
				playbackStartDelayMs: 1150,
			});
			expect(setPlaybackStartDelayMs).toHaveBeenCalledWith(1150);
			await expect(client.api.configureRuntime({ playbackStartDelayMs: -1 })).rejects.toThrow();
		} finally {
			client.close();
		}
	});

	test('相同 endpoint 只有一个 daemon 能监听', async () => {
		expect(await service.start()).toBe(true);
		const duplicate = createService();

		await expect(duplicate.start()).resolves.toBe(false);
		const client = await connect();
		try {
			await expect(client.api.health()).resolves.toMatchObject({ pid: process.pid });
		} finally {
			client.close();
			await duplicate.stop();
		}
	});

	test('shutdown 先返回确认，再关闭 daemon socket', async () => {
		expect(await service.start()).toBe(true);
		const client = await connect();
		await expect(client.api.shutdown()).resolves.toEqual({ accepted: true });
		client.close();

		await expect(waitUntilStopped()).resolves.toBeUndefined();
	});

	function createService() {
		const module = {
			app: {
				getModule: () => ({ configService: { setPlaybackStartDelayMs } }),
			},
			daemonEndpointService: {
				prepare: async (): Promise<void> => undefined,
				resolve: async () => endpoint,
			},
			schedulerService: {
				stop: schedulerStop,
				submit: schedulerSubmit,
			},
		} as unknown as VoiceBriefRuntimeModule;
		return new VoiceBriefDaemonService(module);
	}

	async function connect(): Promise<TestClient> {
		const socket = net.createConnection(endpoint.address);
		await new Promise<void>((resolve, reject) => {
			socket.once('connect', resolve);
			socket.once('error', reject);
		});
		const channel = new RPCChannel<object, VoiceBriefDaemonApi>(nodeStdioTransport({ readable: socket, writable: socket, lifecycle: socket }), {
			onClose: () => channel.destroy(),
			timeout: 1000,
		});
		return {
			api: channel.getAPI(),
			close: () => {
				channel.destroy();
				socket.end();
			},
		};
	}

	async function waitUntilStopped() {
		const deadline = Date.now() + 1000;
		while (Date.now() < deadline) {
			try {
				await fs.stat(endpoint.address);
			} catch {
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		throw new Error('daemon socket 未按时关闭');
	}
});

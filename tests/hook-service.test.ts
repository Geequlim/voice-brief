import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { VoiceBriefHookEvent, VoiceBriefHookEventInput } from '../src/hook/types';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async importOriginal => ({
	...await importOriginal<typeof import('node:child_process')>(),
	spawn: spawnMock,
}));

import { VoiceBriefHookService } from '../src/hook/services/hook-service';
import { VoiceBriefStdinHookTransport } from '../src/hook/transports/stdin-transport';
import { VoiceBriefUnixHookTransport } from '../src/hook/transports/unix-transport';
import type { VoiceBriefHookModule } from '../src/hook';

const tempDirs: string[] = [];

function createEventInput(): VoiceBriefHookEventInput {
	return {
		event: 'audio.preparing',
		briefId: 'brief-1',
		sequence: 1,
		brief: {
			text: '测试 Hook',
			kind: 'final',
			priority: 'normal',
		},
	};
}

function createEvent(): VoiceBriefHookEvent {
	return {
		protocol: 'voice-brief.hook-event',
		version: 2,
		eventId: 'event-1',
		occurredAt: '2026-08-28T00:00:00.000Z',
		...createEventInput(),
	};
}

afterEach(async () => {
	spawnMock.mockReset();
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('VoiceBrief Hook transport', () => {
	test('stdin Hook 通过无 shell 进程接收单行 JSON', async () => {
		const child = new EventEmitter() as EventEmitter & {
			stdin: PassThrough;
			unref(): void;
		};
		const unref = vi.fn();
		child.stdin = new PassThrough();
		child.unref = unref;
		let received = '';
		child.stdin.on('data', chunk => {
			if (!Buffer.isBuffer(chunk)) throw new Error('测试预期 stdin 输出 Buffer');
			received += chunk.toString();
		});
		spawnMock.mockImplementation(() => {
			queueMicrotask(() => child.emit('spawn'));
			return child;
		});

		const transport = new VoiceBriefStdinHookTransport();
		await transport.deliver({
			id: 'overlay',
			transport: 'stdin',
			command: 'voice-brief-overlay',
			args: ['receive'],
		}, createEvent());

		expect(spawnMock).toHaveBeenCalledWith('voice-brief-overlay', ['receive'], {
			detached: true,
			shell: false,
			stdio: ['pipe', 'ignore', 'ignore'],
		});
		expect(received).toBe(`${JSON.stringify(createEvent())}\n`);
		expect(unref).toHaveBeenCalledTimes(1);
	});

	test('Unix Socket Hook 每次连接接收一行 JSON', async () => {
		const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-hook-socket-'));
		tempDirs.push(rootDir);
		const socketPath = path.join(rootDir, 'hook.sock');
		let received = '';
		let resolveReceived: () => void = () => undefined;
		const receivedPromise = new Promise<void>(resolve => {
			resolveReceived = resolve;
		});
		const server = net.createServer(socket => {
			socket.on('data', chunk => {
				received += chunk.toString();
			});
			socket.once('end', resolveReceived);
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(socketPath, resolve);
		});

		try {
			const transport = new VoiceBriefUnixHookTransport();
			await transport.deliver({
				id: 'overlay',
				transport: 'unix',
				socket: socketPath,
			}, createEvent());
			await receivedPromise;
			expect(received).toBe(`${JSON.stringify(createEvent())}\n`);
		} finally {
			await new Promise<void>(resolve => server.close(() => resolve()));
		}
	});
});

describe('VoiceBriefHookService', () => {
	test('并行分发并隔离单个 Hook 的失败', async () => {
		const stdinTransport = {
			deliver: vi.fn().mockResolvedValue(undefined),
		};
		const unixTransport = {
			deliver: vi.fn().mockRejectedValue(new Error('socket unavailable')),
		};
		const service = new VoiceBriefHookService({
			stdinTransport,
			unixTransport,
		} as unknown as VoiceBriefHookModule);

		const result = await service.dispatch([
			{ id: 'command', transport: 'stdin', command: 'receiver' },
			{ id: 'daemon', transport: 'unix', socket: '/tmp/receiver.sock' },
		], createEventInput());

		expect(result.event).toMatchObject({
			protocol: 'voice-brief.hook-event',
			version: 2,
			event: 'audio.preparing',
			briefId: 'brief-1',
		});
		expect(result.event.eventId).toEqual(expect.any(String));
		expect(result.event.occurredAt).toEqual(expect.any(String));
		expect(result.deliveries).toEqual([
			{ id: 'command', ok: true },
			{ id: 'daemon', ok: false, error: 'socket unavailable' },
		]);
	});
});

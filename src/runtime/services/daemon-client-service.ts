import { spawn } from 'node:child_process';
import net from 'node:net';
import { RPCChannel } from 'kkrpc';
import { nodeStdioTransport } from 'kkrpc/stdio';
import { VOICE_BRIEF_DAEMON_ARGUMENT } from '../types';
import type { DaemonRuntimeConfigInput, DaemonRuntimeConfigResult, DaemonSubmitRequest, DaemonSubmitResult, VoiceBriefDaemonApi } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';

interface DaemonClientConnection {
	api: VoiceBriefDaemonApi;
	close(): void;
}

export class VoiceBriefDaemonClientService {
	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async submit(request: DaemonSubmitRequest): Promise<DaemonSubmitResult> {
		const connection = await this.connectCurrentDaemon();
		try {
			return await connection.api.submit(request);
		} finally {
			connection.close();
		}
	}

	async configureRuntime(input: DaemonRuntimeConfigInput): Promise<DaemonRuntimeConfigResult> {
		const connection = await this.connectCurrentDaemon();
		try {
			return await connection.api.configureRuntime(input);
		} finally {
			connection.close();
		}
	}

	private async connectCurrentDaemon(): Promise<DaemonClientConnection> {
		const connection = await this.connect().catch((): undefined => undefined);
		if (!connection) {
			await this.startDaemon();
			return this.waitForDaemon();
		}

		let version: string;
		try {
			const health = await connection.api.health();
			version = health.version;
		} catch {
			connection.close();
			await this.startDaemon();
			return this.waitForDaemon();
		}
		if (version === VERSION.name) return connection;

		await connection.api.shutdown().catch((): undefined => undefined);
		connection.close();

		await this.waitForStop();
		await this.startDaemon();
		return this.waitForDaemon();
	}

	private async connect(): Promise<DaemonClientConnection> {
		const endpoint = await this.module.daemonEndpointService.resolve();
		const socket = net.createConnection(endpoint.address);
		await new Promise<void>((resolve, reject) => {
			const fail = (error: Error) => {
				socket.destroy();
				reject(error);
			};
			socket.setTimeout(300, () => fail(new Error('连接 voice-brief daemon 超时')));
			socket.once('error', fail);
			socket.once('connect', () => {
				socket.setTimeout(0);
				socket.off('error', fail);
				resolve();
			});
		});

		const channel = new RPCChannel<object, VoiceBriefDaemonApi>(nodeStdioTransport({ readable: socket, writable: socket, lifecycle: socket }), {
			onClose: () => channel.destroy(),
			timeout: 3000,
		});
		return {
			api: channel.getAPI(),
			close: () => {
				channel.destroy();
				socket.end();
			},
		};
	}

	private async startDaemon() {
		const endpoint = await this.module.daemonEndpointService.resolve();
		if (endpoint.socketFile) {
			await this.module.daemonEndpointService.prepare(endpoint);
		}
		const entryFile = process.argv[1];
		if (!entryFile) throw new Error('无法定位 voice-brief 运行入口');
		const child = spawn(process.execPath, [...process.execArgv, entryFile, VOICE_BRIEF_DAEMON_ARGUMENT], {
			detached: true,
			env: process.env,
			stdio: 'ignore',
			windowsHide: true,
		});
		await new Promise<void>((resolve, reject) => {
			child.once('error', reject);
			child.once('spawn', resolve);
		});
		child.unref();
	}

	private async waitForDaemon() {
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			const connection = await this.connect().catch((): undefined => undefined);
			if (connection) {
				try {
					const health = await connection.api.health();
					if (health.version === VERSION.name) return connection;
				} catch {
					// daemon 仍在启动或正在被其他 CLI 替换，继续重试。
				}
				connection.close();
			}
			await this.delay(50);
		}
		throw new Error('voice-brief daemon 启动超时');
	}

	private async waitForStop() {
		const deadline = Date.now() + 3000;
		while (Date.now() < deadline) {
			const connection = await this.connect().catch((): undefined => undefined);
			if (!connection) return;
			connection.close();
			await this.delay(50);
		}
		throw new Error('旧版 voice-brief daemon 停止超时');
	}

	private async delay(ms: number) {
		await new Promise(resolve => setTimeout(resolve, ms));
	}
}

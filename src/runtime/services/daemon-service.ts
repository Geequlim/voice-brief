import { parseValue } from '../../infrastructure/schema';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import { RPCChannel } from 'kkrpc';
import { nodeStdioTransport } from 'kkrpc/stdio';
import { hasErrorCode } from '../../error';
import { DaemonRuntimeConfigInputSchema, DaemonSubmitRequestSchema } from '../schema';
import type { DaemonHealthResult, DaemonRuntimeConfigInput, DaemonRuntimeConfigResult, DaemonShutdownResult, DaemonSubmitRequest, DaemonSubmitResult, VoiceBriefDaemonApi } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';
import type { VoiceBriefDaemonEndpoint } from './daemon-endpoint-service';

interface DaemonConfigModule {
	configService: {
		setPlaybackStartDelayMs(startDelayMs: number): Promise<{ playback: { startDelayMs: number; }; }>;
	};
}

class VoiceBriefDaemonRpc implements VoiceBriefDaemonApi {
	constructor(private readonly $service: VoiceBriefDaemonService) {}

	async configureRuntime(input: DaemonRuntimeConfigInput): Promise<DaemonRuntimeConfigResult> {
		const config = parseValue(DaemonRuntimeConfigInputSchema, input);
		return this.$service.configureRuntime(config);
	}

	async health(): Promise<DaemonHealthResult> {
		return {
			pid: process.pid,
			version: VERSION.name,
		};
	}

	async shutdown(): Promise<DaemonShutdownResult> {
		setImmediate(() => {
			void this.$service.stop();
		});
		return { accepted: true };
	}

	async submit(input: DaemonSubmitRequest): Promise<DaemonSubmitResult> {
		const request = parseValue(DaemonSubmitRequestSchema, input);
		const requestId = randomUUID();
		return this.$service.submit(requestId, request);
	}
}

export class VoiceBriefDaemonService {
	private readonly $connections = new Set<net.Socket>();
	private $endpoint?: VoiceBriefDaemonEndpoint;
	private $exitOnStop = false;
	private $server?: net.Server;
	private $socketIdentity?: { dev: number; ino: number; };

	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async start(exitOnStop = false) {
		this.$exitOnStop = exitOnStop;
		const endpoint = await this.module.daemonEndpointService.resolve();
		await this.module.daemonEndpointService.prepare(endpoint);
		if (await this.listen(endpoint)) return true;
		if (!endpoint.socketFile || !endpoint.recoveryFile) return false;

		const release = await this.acquireRecovery(endpoint.recoveryFile);
		if (!release) return false;
		try {
			if (await this.canConnect(endpoint.address)) return false;
			await fs.rm(endpoint.socketFile, { force: true });
			return this.listen(endpoint);
		} finally {
			await release();
		}
	}

	async stop() {
		const server = this.$server;
		const endpoint = this.$endpoint;
		const socketIdentity = this.$socketIdentity;
		if (!server) return;
		this.$server = undefined;
		this.$endpoint = undefined;
		this.$socketIdentity = undefined;
		await this.module.schedulerService.stop();
		const closed = new Promise<void>(resolve => server.close(() => resolve()));
		for (const socket of this.$connections) socket.end();
		await closed;
		if (endpoint?.socketFile && socketIdentity && await this.isSameSocket(endpoint.socketFile, socketIdentity)) {
			await fs.rm(endpoint.socketFile, { force: true });
		}
		if (this.$exitOnStop) process.exit(0);
	}

	submit(requestId: string, request: DaemonSubmitRequest) {
		return this.module.schedulerService.submit(requestId, request);
	}

	async configureRuntime(input: DaemonRuntimeConfigInput): Promise<DaemonRuntimeConfigResult> {
		const configModule = this.module.app.getModule('VoiceBriefConfigModule') as DaemonConfigModule;
		const config = await configModule.configService.setPlaybackStartDelayMs(input.playbackStartDelayMs);
		return { playbackStartDelayMs: config.playback.startDelayMs };
	}

	private async listen(endpoint: VoiceBriefDaemonEndpoint) {
		const server = net.createServer(socket => this.accept(socket));
		try {
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(endpoint.address, () => {
					server.off('error', reject);
					resolve();
				});
			});
		} catch (error) {
			if (hasErrorCode(error, 'EADDRINUSE')) return false;
			throw error;
		}
		if (endpoint.socketFile) {
			await fs.chmod(endpoint.socketFile, 0o600);
			const stat = await fs.stat(endpoint.socketFile);
			this.$socketIdentity = { dev: stat.dev, ino: stat.ino };
		}
		this.$server = server;
		this.$endpoint = endpoint;
		return true;
	}

	private accept(socket: net.Socket) {
		this.$connections.add(socket);
		const channel = new RPCChannel<VoiceBriefDaemonApi, object>(nodeStdioTransport({ readable: socket, writable: socket, lifecycle: socket }), {
			expose: new VoiceBriefDaemonRpc(this),
			onClose: () => channel.destroy(),
		});
		socket.once('close', () => {
			this.$connections.delete(socket);
		});
	}

	private async canConnect(address: string) {
		return new Promise<boolean>(resolve => {
			const socket = net.createConnection(address);
			const finish = (connected: boolean) => {
				socket.destroy();
				resolve(connected);
			};
			socket.setTimeout(250, () => finish(false));
			socket.once('connect', () => finish(true));
			socket.once('error', () => finish(false));
		});
	}

	private async acquireRecovery(recoveryFile: string): Promise<(() => Promise<void>) | undefined> {
		try {
			const handle = await fs.open(recoveryFile, 'wx');
			await handle.writeFile(String(process.pid), 'utf-8');
			await handle.close();
			return async () => fs.rm(recoveryFile, { force: true });
		} catch (error) {
			if (!hasErrorCode(error, 'EEXIST')) throw error;
			if (!await this.removeStaleRecovery(recoveryFile)) return undefined;
			return this.acquireRecovery(recoveryFile);
		}
	}

	private async removeStaleRecovery(recoveryFile: string) {
		try {
			const owner = Number(await fs.readFile(recoveryFile, 'utf-8'));
			if (Number.isInteger(owner) && owner > 0 && this.processExists(owner)) return false;
			await fs.rm(recoveryFile, { force: true });
			return true;
		} catch (error) {
			return hasErrorCode(error, 'ENOENT');
		}
	}

	private processExists(pid: number) {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return hasErrorCode(error, 'EPERM');
		}
	}

	private async isSameSocket(socketFile: string, identity: { dev: number; ino: number; }) {
		try {
			const stat = await fs.stat(socketFile);
			return stat.dev === identity.dev && stat.ino === identity.ino;
		} catch (error) {
			if (hasErrorCode(error, 'ENOENT')) return false;
			throw error;
		}
	}
}

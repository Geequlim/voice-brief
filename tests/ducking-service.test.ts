import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { VoiceBriefConfig } from '../src/config/schema';
import type { VoiceBriefPaths } from '../src/config/types';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import { VoiceBriefDuckingService } from '../src/runtime/services/ducking-service';

const APP_RULE_ID = 'sink-input-by-application-name:TestApp';

interface MockStream {
	index: number;
	volume: number;
	applicationName?: string;
	restoreId?: string;
}

interface JournalSnapshot {
	streams: unknown[];
	pending?: Array<{ index: number; restoreId: string; originalVolumes: number[]; duckedVolumes: number[] }>;
}

class TestDuckingService extends VoiceBriefDuckingService {
	readonly calls: string[][] = [];
	readonly waits: number[] = [];
	streams: MockStream[] = [{ index: 42, volume: 10000 }];

	protected override async runPactl(args: string[]) {
		this.calls.push(args);
		if (args[0] === '--format=json') {
			return JSON.stringify(this.streams.map(stream => {
				const properties = {
					...(stream.applicationName ? { 'application.name': stream.applicationName } : {}),
					...(stream.restoreId ? { 'module-stream-restore.id': stream.restoreId } : {}),
				};
				return {
					index: stream.index,
					volume: {
						'front-left': { value: stream.volume },
						'front-right': { value: stream.volume },
					},
					...(Object.keys(properties).length > 0 ? { properties } : {}),
				};
			}));
		}
		if (args[0] === 'set-sink-input-volume') {
			const stream = this.streams.find(candidate => candidate.index === Number(args[1]));
			if (!stream) throw new Error(`unknown sink input: ${args[1]}`);
			stream.volume = Number(args[2]);
			return '';
		}
		throw new Error(`unexpected pactl args: ${args.join(' ')}`);
	}

	protected override async delay(durationMs: number) {
		this.waits.push(durationMs);
	}
}

const createConfig = (enabled = true, restoreFadeMs = 0): VoiceBriefConfig => ({
	version: 1,
	enabled: true,
	provider: 'edge',
	hooks: [],
	providers: {},
	playback: {
		command: 'auto',
		startDelayMs: 0,
		ducking: {
			enabled,
			attenuationDb: 18,
			restoreFadeMs,
		},
	},
	cache: {
		enabled: true,
		ttlMs: 60000,
		maxEntries: 100,
		pruneIntervalMs: 30000,
	},
	throttle: {
		progressIntervalMs: 30000,
		highPriorityIntervalMs: 5000,
		networkCheckTtlMs: 60000,
	},
});

const createPaths = (root: string): VoiceBriefPaths => ({
	configDir: root,
	configFile: path.join(root, 'config.yaml'),
	personaDir: path.join(root, 'personas'),
	stateDir: root,
	stateFile: path.join(root, 'state.yaml'),
	cacheDir: path.join(root, 'cache'),
	tempDir: path.join(root, 'tmp'),
});

const writeJournalFile = async (root: string, journal: unknown) => {
	await fs.writeFile(path.join(root, 'ducking-session.json'), JSON.stringify(journal), 'utf-8');
};

const exitedPid = process.pid + 999999999;

describe('VoiceBriefDuckingService', () => {
	test.runIf(process.platform === 'linux')('Linux 支持 pactl 时会压低音量并在播放结束后恢复', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-ducking-'));
		try {
			const service = new TestDuckingService({} as VoiceBriefRuntimeModule);
			const play = vi.fn(async () => undefined);

			await service.playWithDucking(createPaths(root), createConfig(), play);

			expect(play).toHaveBeenCalledTimes(1);
			expect(service.calls).toContainEqual(['set-sink-input-volume', '42', '5012', '5012']);
			expect(service.calls).toContainEqual(['set-sink-input-volume', '42', '10000', '10000']);
			expect(service.streams[0]?.volume).toBe(10000);
			await expect(fs.access(path.join(root, 'ducking-session.json'))).rejects.toThrow();
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test.runIf(process.platform === 'linux')('Cinnamon KTV 冒烟播放器不会被压低或写入恢复日志', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-ducking-'));
		try {
			const service = new TestDuckingService({} as VoiceBriefRuntimeModule);
			service.streams = [
				{ index: 42, volume: 10000, applicationName: 'voice-brief-cinnamon-smoke' },
				{ index: 43, volume: 10000 },
			];

			await service.playWithDucking(createPaths(root), createConfig(), async () => undefined);

			expect(service.calls).not.toContainEqual(['set-sink-input-volume', '42', '5012', '5012']);
			expect(service.calls).not.toContainEqual(['set-sink-input-volume', '42', '10000', '10000']);
			expect(service.calls).toContainEqual(['set-sink-input-volume', '43', '5012', '5012']);
			expect(service.calls).toContainEqual(['set-sink-input-volume', '43', '10000', '10000']);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test.runIf(process.platform === 'linux')('恢复音量时会按分贝曲线平滑回到原音量', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-ducking-'));
		try {
			const service = new TestDuckingService({} as VoiceBriefRuntimeModule);

			await service.playWithDucking(createPaths(root), createConfig(true, 700), async () => undefined);

			const volumeCalls = service.calls.filter(args => args[0] === 'set-sink-input-volume');
			const restoredVolumes = volumeCalls.slice(1).map(args => Number(args[2]));
			expect(service.waits).toEqual(Array.from({ length: 14 }, () => 50));
			expect(restoredVolumes).toHaveLength(14);
			expect(restoredVolumes[0]).toBeGreaterThan(5012);
			expect(restoredVolumes.at(-1)).toBe(10000);
			expect(restoredVolumes.every((volume, index) => index === 0 || volume > restoredVolumes[index - 1])).toBe(true);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test.runIf(process.platform === 'linux')('播放期间音量被手动调整后不会等待或覆盖', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-ducking-'));
		try {
			const service = new TestDuckingService({} as VoiceBriefRuntimeModule);

			await service.playWithDucking(createPaths(root), createConfig(true, 700), async () => {
				const stream = service.streams[0];
				if (stream) stream.volume = 8000;
			});

			expect(service.waits).toEqual([]);
			expect(service.calls.filter(args => args[0] === 'set-sink-input-volume')).toHaveLength(1);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test.runIf(process.platform === 'linux')('流在压低期间消失时把泄漏登记为待修复条目', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-ducking-'));
		try {
			const service = new TestDuckingService({} as VoiceBriefRuntimeModule);
			service.streams = [{ index: 42, volume: 10000, restoreId: APP_RULE_ID }];

			await service.playWithDucking(createPaths(root), createConfig(), async () => {
				service.streams = [];
			});

			expect(service.calls.filter(args => args[0] === 'set-sink-input-volume')).toHaveLength(1);
			const journal = JSON.parse(await fs.readFile(path.join(root, 'ducking-session.json'), 'utf-8')) as JournalSnapshot;
			expect(journal.streams).toEqual([]);
			expect(journal.pending).toEqual([{
				index: 42,
				restoreId: APP_RULE_ID,
				originalVolumes: [10000, 10000],
				duckedVolumes: [5012, 5012],
			}]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test.runIf(process.platform === 'linux')('应用重新出声后按规则修复泄漏并容忍量化偏差', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-ducking-'));
		try {
			const service = new TestDuckingService({} as VoiceBriefRuntimeModule);
			await writeJournalFile(root, {
				pid: exitedPid,
				streams: [],
				pending: [{ index: 42, restoreId: APP_RULE_ID, originalVolumes: [10000, 10000], duckedVolumes: [5012, 5012] }],
			});
			service.streams = [{ index: 7, volume: 5020, restoreId: APP_RULE_ID }];

			const play = vi.fn(async () => undefined);
			await service.playWithDucking(createPaths(root), createConfig(), play);

			expect(service.calls).toContainEqual(['set-sink-input-volume', '7', '10000', '10000']);
			expect(service.calls).toContainEqual(['set-sink-input-volume', '7', '5012', '5012']);
			expect(play).toHaveBeenCalledTimes(1);
			await expect(fs.access(path.join(root, 'ducking-session.json'))).rejects.toThrow();
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test.runIf(process.platform === 'linux')('应用当前没有出声时继续保留待修复条目', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-ducking-'));
		try {
			const service = new TestDuckingService({} as VoiceBriefRuntimeModule);
			await writeJournalFile(root, {
				pid: exitedPid,
				streams: [],
				pending: [{ index: 42, restoreId: APP_RULE_ID, originalVolumes: [10000, 10000], duckedVolumes: [5012, 5012] }],
			});
			service.streams = [];

			const play = vi.fn(async () => undefined);
			await service.playWithDucking(createPaths(root), createConfig(), play);

			expect(play).toHaveBeenCalledTimes(1);
			const journal = JSON.parse(await fs.readFile(path.join(root, 'ducking-session.json'), 'utf-8')) as JournalSnapshot;
			expect(journal.pending).toEqual([{
				index: 42,
				restoreId: APP_RULE_ID,
				originalVolumes: [10000, 10000],
				duckedVolumes: [5012, 5012],
			}]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test.runIf(process.platform === 'linux')('音量已被外部改动时丢弃待修复条目且不覆盖新值', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-ducking-'));
		try {
			const service = new TestDuckingService({} as VoiceBriefRuntimeModule);
			await writeJournalFile(root, {
				pid: exitedPid,
				streams: [],
				pending: [{ index: 42, restoreId: APP_RULE_ID, originalVolumes: [10000, 10000], duckedVolumes: [5012, 5012] }],
			});
			service.streams = [{ index: 7, volume: 8000, restoreId: APP_RULE_ID }];

			const play = vi.fn(async () => undefined);
			await service.playWithDucking(createPaths(root), createConfig(), play);

			expect(play).toHaveBeenCalledTimes(1);
			expect(service.calls).not.toContainEqual(['set-sink-input-volume', '7', '10000', '10000']);
			await expect(fs.access(path.join(root, 'ducking-session.json'))).rejects.toThrow();
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test.runIf(process.platform === 'linux')('旧格式日志在崩溃恢复时仍按 index 修复', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-ducking-'));
		try {
			const service = new TestDuckingService({} as VoiceBriefRuntimeModule);
			await writeJournalFile(root, {
				pid: exitedPid,
				streams: [{ index: 42, originalVolumes: [10000, 10000], duckedVolumes: [5012, 5012] }],
			});
			service.streams = [{ index: 42, volume: 5012 }];

			const play = vi.fn(async () => undefined);
			await service.playWithDucking(createPaths(root), createConfig(), play);

			expect(service.calls).toContainEqual(['set-sink-input-volume', '42', '10000', '10000']);
			expect(service.calls).toContainEqual(['set-sink-input-volume', '42', '5012', '5012']);
			await expect(fs.access(path.join(root, 'ducking-session.json'))).rejects.toThrow();
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('明确关闭时不会执行环境探测', async () => {
		const service = new TestDuckingService({} as VoiceBriefRuntimeModule);
		const play = vi.fn(async () => undefined);

		await service.playWithDucking(createPaths('/tmp/unused-voice-brief'), createConfig(false), play);

		expect(play).toHaveBeenCalledTimes(1);
		expect(service.calls).toEqual([]);
	});
});

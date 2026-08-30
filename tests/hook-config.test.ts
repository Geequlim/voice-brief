import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { VoiceBriefConfigService } from '../src/config/services/config-service';
import type { VoiceBriefConfigModule } from '../src/config';

const tempDirs: string[] = [];

async function createService(configText: string) {
	const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-hook-config-'));
	tempDirs.push(rootDir);
	const configFile = path.join(rootDir, 'config.yaml');
	await fs.writeFile(configFile, configText, 'utf-8');
	return new VoiceBriefConfigService({
		pathService: {
			ensureVoiceBriefDirs: async (): Promise<void> => undefined,
			resolveVoiceBriefPaths: async () => ({ configFile }),
		},
	} as unknown as VoiceBriefConfigModule);
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('VoiceBrief Hook 配置', () => {
	test('未配置 hooks 时使用空数组', async () => {
		const service = await createService('version: 1\n');
		await expect(service.load()).resolves.toMatchObject({ hooks: [] });
	});

	test('解析 stdin 和 Unix Socket Hook', async () => {
		const service = await createService(`
hooks:
  - id: overlay-command
    transport: stdin
    command: voice-brief-overlay
    args: [receive]
  - id: overlay-daemon
    transport: unix
    socket: /tmp/voice-brief-overlay.sock
    timeoutMs: 1500
`);

		await expect(service.load()).resolves.toMatchObject({
			hooks: [
				{
					id: 'overlay-command',
					transport: 'stdin',
					command: 'voice-brief-overlay',
					args: ['receive'],
				},
				{
					id: 'overlay-daemon',
					transport: 'unix',
					socket: '/tmp/voice-brief-overlay.sock',
					timeoutMs: 1500,
				},
			],
		});
	});

	test('拒绝重复 Hook id', async () => {
		const service = await createService(`
hooks:
  - id: overlay
    transport: stdin
    command: first
  - id: overlay
    transport: stdin
    command: second
`);

		await expect(service.load()).rejects.toThrow('Hook id 重复: overlay');
	});

	test('拒绝相对 Unix Socket 路径', async () => {
		const service = await createService(`
hooks:
  - id: overlay
    transport: unix
    socket: overlay.sock
`);

		await expect(service.load()).rejects.toThrow('hooks[0].socket 必须是绝对路径');
	});

	test('拒绝未声明的配置字段', async () => {
		const service = await createService('version: 1\nexperimental: true\n');

		await expect(service.load()).rejects.toThrow();
	});

	test('拒绝非法 Fish Audio 格式', async () => {
		const service = await createService(`
providers:
  fish:
    format: aac
`);

		await expect(service.load()).rejects.toThrow();
	});

	test('provider concurrency 可选且必须为正整数', async () => {
		const configured = await createService(`
providers:
  fish:
    concurrency: 2
`);
		await expect(configured.load()).resolves.toMatchObject({
			providers: { fish: { concurrency: 2 } },
		});

		const invalid = await createService(`
providers:
  edge:
    concurrency: 0
`);
		await expect(invalid.load()).rejects.toThrow();
	});

	test('播放启动延迟可配置', async () => {
		const configured = await createService(`
playback:
  startDelayMs: 750
`);
		await expect(configured.load()).resolves.toMatchObject({
			playback: { startDelayMs: 750 },
		});
	});

	test('旧 wait 配置迁移后写回规范字段', async () => {
		const legacyWait = await createService(`
playback:
  wait: false
`);
		await expect(legacyWait.load()).resolves.toMatchObject({
			playback: { startDelayMs: 0 },
		});
		const waitConfig = await fs.readFile((await legacyWait.module.pathService.resolveVoiceBriefPaths()).configFile, 'utf-8');
		expect(waitConfig).not.toContain('wait:');
		expect(waitConfig).toContain('startDelayMs: 0');
	});

	test('拒绝不存在于历史配置中的表现层字段', async () => {
		const invalid = await createService(`
playback:
  presentationLeadMs: 750
`);
		await expect(invalid.load()).rejects.toThrow();
	});
});

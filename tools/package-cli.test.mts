import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const workspace = path.resolve(import.meta.dirname, '..');
const staging = path.join(workspace, 'dist', 'npm', 'voice-brief');
const yarn = path.join(workspace, '.yarn', 'releases', 'yarn-4.17.1.cjs');

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
	return execFileSync(command, args, {
		cwd: options.cwd ?? workspace,
		env: { ...process.env, ...options.env },
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

let tarballPath = '';

afterAll(() => {
	if (tarballPath && fs.existsSync(tarballPath)) fs.rmSync(tarballPath);
});

describe('CLI 打包验证', () => {
	test('staging 组装与白名单校验', () => {
		run('node', ['tools/package-cli.mts']);
		const check = run('node', ['tools/check-package.mts']);
		expect(check).toContain('检查通过');

		for (const file of ['index.js', 'index.bin.js', 'dependencies.js', 'package.json', 'README.md', 'LICENSE']) {
			expect(fs.existsSync(path.join(staging, file)), `缺少 ${file}`).toBe(true);
		}
		const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8')) as {
			name: string;
			license: string;
			private?: boolean;
			bin: string | Record<string, string>;
			engines: Record<string, string>;
			version: string;
		};
		expect(manifest.name).toBe('@tinyaxis/voice-brief');
		expect(manifest.license).toBe('MIT');
		expect(manifest.private).toBeUndefined();
		// yarn install 会把单条目 bin 规范化为字符串简写；两种形态对 npm 等价
		const bin = typeof manifest.bin === 'string' ? { 'voice-brief': manifest.bin } : manifest.bin;
		expect(bin).toEqual({ 'voice-brief': './index.bin.js' });
		expect(manifest.engines).toEqual({ node: '>=24.0.0' });
		expect(manifest.version).toBe('0.4.0');
	}, 60_000);

	test('打包 npm tarball', () => {
		run('node', [yarn, 'pack'], { cwd: staging });
		const files = fs.readdirSync(staging).filter(file => file.endsWith('.tgz'));
		expect(files.length).toBe(1);
		tarballPath = path.join(staging, files[0]);
	}, 120_000);

	test('隔离环境安装 tarball 并冒烟 help/init/status/doctor', () => {
		expect(tarballPath).toBeTruthy();
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-brief-verify-'));
		const env: NodeJS.ProcessEnv = {
			HOME: home,
			XDG_CONFIG_HOME: path.join(home, '.config'),
			XDG_CACHE_HOME: path.join(home, '.cache'),
			XDG_DATA_HOME: path.join(home, '.local', 'share'),
			XDG_STATE_HOME: path.join(home, '.local', 'state'),
			YARN_ENABLE_TELEMETRY: '0',
			YARN_ENABLE_GLOBAL_CACHE: '0',
		};
		const project = path.join(home, 'verify');
		fs.mkdirSync(project, { recursive: true });
		fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'voice-brief-verify', private: true }, null, '\t'));
		fs.writeFileSync(path.join(project, '.yarnrc.yml'), 'nodeLinker: node-modules\n');

		run('node', [yarn, 'add', `@tinyaxis/voice-brief@file:${tarballPath}`], { cwd: project, env });

		const bin = path.join(project, 'node_modules', '.bin', 'voice-brief');
		const smoke = (args: string[]) => spawnSync(bin, args, { env: { ...process.env, ...env }, encoding: 'utf8' });

		const help = smoke(['--help']);
		expect(help.status).toBe(0);
		expect(help.stdout).toContain('Usage: voice-brief [options] [command]');

		const init = smoke(['init']);
		expect(init.status).toBe(0);
		expect(fs.existsSync(path.join(home, '.config', 'voice-brief', 'config.yaml'))).toBe(true);

		const status = smoke(['status', '--json']);
		expect(status.status).toBe(0);
		const statusJson = JSON.parse(status.stdout) as { config?: { enabled?: boolean } };
		expect(statusJson.config?.enabled).toBe(true);

		const doctor = smoke(['doctor']);
		// 裸环境可能没有任何音频播放器：doctor 会照常输出报告，并以退出码 1 表示环境不完整
		expect([0, 1]).toContain(doctor.status);
		expect(doctor.stdout).toContain('Config:');
		expect(doctor.stdout).toContain('edge:');

		fs.rmSync(home, { recursive: true, force: true });
	}, 300_000);
});

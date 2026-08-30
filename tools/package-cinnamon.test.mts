import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const workspace = path.resolve(import.meta.dirname, '..');
const staging = path.join(workspace, 'dist', 'npm', 'voice-brief-cinnamon');
const yarn = path.join(workspace, '.yarn', 'releases', 'yarn-4.17.1.cjs');
const UUID = 'voice-brief@tinyaxis';

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

describe('Cinnamon 打包与自动安装验证', () => {
	test('staging 组装与 manifest 校验', () => {
		run('node', ['tools/package-cinnamon.mts']);
		expect(fs.existsSync(path.join(staging, 'extension', UUID, 'metadata.json'))).toBe(true);
		expect(fs.existsSync(path.join(staging, 'extension', UUID, 'extension.js'))).toBe(true);
		expect(fs.existsSync(path.join(staging, 'scripts', 'install.js'))).toBe(true);
		const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8')) as {
			name: string;
			version: string;
			license: string;
			os: string[];
			engines: { node: string };
			scripts: { postinstall: string };
		};
		expect(manifest.name).toBe('@tinyaxis/voice-brief-cinnamon');
		expect(manifest.version).toBe('0.4.0');
		expect(manifest.license).toBe('MIT');
		expect(manifest.os).toEqual(['linux']);
		expect(manifest.engines.node).toBe('>=24.0.0');
		expect(manifest.scripts.postinstall).toBe('node scripts/install.js');

		// workspace manifest 不得声明 postinstall，防止根 yarn install 覆盖开发者扩展
		const workspaceManifest = JSON.parse(fs.readFileSync(path.join(workspace, 'packages', 'cinnamon', 'package.json'), 'utf8')) as { scripts?: { postinstall?: string } };
		expect(workspaceManifest.scripts?.postinstall).toBeUndefined();
	}, 60_000);

	test('打包 npm tarball', () => {
		run('node', [yarn, 'pack'], { cwd: staging });
		const files = fs.readdirSync(staging).filter(file => file.endsWith('.tgz'));
		expect(files.length).toBe(1);
		tarballPath = path.join(staging, files[0]);
	}, 120_000);

	test('隔离 XDG 环境验证首装、升级替换与失败恢复', () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-brief-cinnamon-verify-'));
		const dataHome = path.join(home, 'data');
		const extensionsRoot = path.join(dataHome, 'cinnamon', 'extensions');
		const target = path.join(extensionsRoot, UUID);
		const env = { HOME: home, XDG_DATA_HOME: dataHome };

		const install = () => spawnSync('node', [path.join(staging, 'scripts', 'install.js')], {
			env: { ...process.env, ...env },
			encoding: 'utf8',
		});

		// 首次安装
		const first = install();
		expect(first.status).toBe(0);
		expect(fs.existsSync(path.join(target, 'extension.js'))).toBe(true);
		expect(fs.readdirSync(extensionsRoot).filter(name => name.startsWith('.voice-brief-'))).toEqual([]);

		// 升级替换：修改安装产物中的一个文件后重装，内容应被还原且无备份残留
		fs.writeFileSync(path.join(target, 'marker.txt'), 'dirty');
		const upgrade = install();
		expect(upgrade.status).toBe(0);
		expect(fs.existsSync(path.join(target, 'marker.txt'))).toBe(false);
		expect(fs.existsSync(path.join(extensionsRoot, `.voice-brief-backup-${UUID}`))).toBe(false);
		expect(fs.readdirSync(extensionsRoot).filter(name => name.startsWith('.voice-brief-'))).toEqual([]);

		// 失败恢复：目标父目录只读时安装失败，已有安装保持原样
		fs.chmodSync(extensionsRoot, 0o500);
		const failed = install();
		expect(failed.status).not.toBe(0);
		fs.chmodSync(extensionsRoot, 0o755);
		expect(fs.existsSync(path.join(target, 'extension.js'))).toBe(true);
		expect(fs.existsSync(path.join(extensionsRoot, `.voice-brief-backup-${UUID}`))).toBe(false);

		fs.rmSync(home, { recursive: true, force: true });
	}, 120_000);
});

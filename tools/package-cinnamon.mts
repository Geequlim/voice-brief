import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const workspace = path.resolve(import.meta.dirname, '..');
const extensionBuild = path.join(workspace, 'packages', 'cinnamon', 'dist', 'voice-brief@tinyaxis');
const stagingDirectory = path.join(workspace, 'dist', 'npm', 'voice-brief-cinnamon');
const UUID = 'voice-brief@tinyaxis';

function fail(message: string): never {
	console.error(`[package-cinnamon] ${message}`);
	process.exit(1);
}

function main() {
	for (const file of ['metadata.json', 'extension.js']) {
		if (!fs.existsSync(path.join(extensionBuild, file))) {
			fail(`缺少扩展构建产物 ${file}，请先执行 yarn tiny compile/cinnamon`);
		}
	}

	const rootManifest = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')) as { version: string };
	const manifest = {
		name: '@tinyaxis/voice-brief-cinnamon',
		version: rootManifest.version,
		description: 'Cinnamon desktop overlay for Voice Brief hook events',
		license: 'MIT',
		repository: {
			type: 'git',
			url: 'git+https://github.com/Geequlim/voice-brief.git',
		},
		bugs: {
			url: 'https://github.com/Geequlim/voice-brief/issues',
		},
		homepage: 'https://github.com/Geequlim/voice-brief#readme',
		os: ['linux'],
		engines: {
			node: '>=24.0.0',
		},
		files: [
			'extension',
			'scripts',
			'README.md',
			'LICENSE',
		],
		scripts: {
			// 仅 staging manifest 声明 postinstall；workspace manifest 不得携带，避免开发环境覆盖真实扩展
			postinstall: 'node scripts/install.js',
		},
	};

	fs.rmSync(stagingDirectory, { recursive: true, force: true });
	fs.mkdirSync(path.join(stagingDirectory, 'extension'), { recursive: true });
	fs.mkdirSync(path.join(stagingDirectory, 'scripts'), { recursive: true });
	fs.cpSync(extensionBuild, path.join(stagingDirectory, 'extension', UUID), { recursive: true });
	fs.copyFileSync(path.join(workspace, 'tools', 'cinnamon-install.js'), path.join(stagingDirectory, 'scripts', 'install.js'));
	fs.copyFileSync(path.join(workspace, 'packages', 'cinnamon', 'README.md'), path.join(stagingDirectory, 'README.md'));
	fs.copyFileSync(path.join(workspace, 'LICENSE'), path.join(stagingDirectory, 'LICENSE'));
	fs.writeFileSync(path.join(stagingDirectory, 'package.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	// 占位锁文件使 staging 被视为独立项目，随后填充真实解析记录
	fs.writeFileSync(path.join(stagingDirectory, 'yarn.lock'), '\n');

	// npm publish 需要锁文件里有本包的解析记录；update-lockfile 模式只生成锁文件，不安装链接
	const yarnRelease = path.join(workspace, '.yarn', 'releases', 'yarn-4.17.1.cjs');
	const lockfile = spawnSync(process.execPath, [yarnRelease, 'install', '--mode=update-lockfile'], {
		cwd: stagingDirectory,
		stdio: 'inherit',
		env: { ...process.env, YARN_ENABLE_TELEMETRY: '0' },
	});
	if (lockfile.status !== 0) fail('staging lockfile 生成失败');

	console.log(`[package-cinnamon] staging 组装完成: ${path.relative(workspace, stagingDirectory)}`);
}

main();

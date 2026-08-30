import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';

const workspace = path.resolve(import.meta.dirname, '..');
const buildDirectory = path.join(workspace, 'dist', 'voice-brief');
const stagingDirectory = path.join(workspace, 'dist', 'npm', 'voice-brief');
const SHIPPED_FILES = ['index.js', 'index.bin.js', 'dependencies.js'] as const;

function fail(message: string): never {
	console.error(`[package-cli] ${message}`);
	process.exit(1);
}

function readJson(file: string) {
	return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** 从 bundle 中提取仍以 require 形式引用的运行时依赖（即 external 集合） */
function collectBundleExternals(): string[] {
	const externalPattern = /require\("((?:@[^/"]+\/)?[^./"][^"]*)"\)/g;
	const externals = new Set<string>();
	for (const file of SHIPPED_FILES) {
		const content = fs.readFileSync(path.join(buildDirectory, file), 'utf8');
		for (const match of content.matchAll(externalPattern)) {
			const request = match[1];
			if (request.startsWith('node:') || isBuiltin(request)) continue;
			const parts = request.split('/');
			externals.add(request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
		}
	}
	return [...externals].sort();
}

/** 依赖版本：根 manifest 直接依赖沿用其范围，传递依赖锁定当前安装的精确版本 */
function resolveDependencySpec(name: string): string {
	const rootManifest = readJson(path.join(workspace, 'package.json')) as { dependencies?: Record<string, string> };
	const rootSpec = rootManifest.dependencies?.[name];
	if (rootSpec) return rootSpec;
	const installed = readJson(path.join(workspace, 'node_modules', name, 'package.json')) as { version?: string };
	if (!installed.version) fail(`无法确定依赖 ${name} 的版本`);
	return installed.version;
}

function main() {
	for (const file of SHIPPED_FILES) {
		if (!fs.existsSync(path.join(buildDirectory, file))) {
			fail(`缺少构建产物 ${file}，请先执行 yarn tiny compile/cli`);
		}
	}

	const rootManifest = readJson(path.join(workspace, 'package.json')) as { version: string };
	const externals = collectBundleExternals();
	if (externals.length === 0) fail('未从产物中发现任何 external 依赖，构建配置可能异常');

	const dependencies: Record<string, string> = {};
	for (const name of externals) {
		dependencies[name] = resolveDependencySpec(name);
	}

	const manifest = {
		name: '@tinyaxis/voice-brief',
		version: rootManifest.version,
		description: 'Local voice briefing CLI for coding agents',
		license: 'MIT',
		repository: {
			type: 'git',
			url: 'git+https://github.com/Geequlim/voice-brief.git',
		},
		bugs: {
			url: 'https://github.com/Geequlim/voice-brief/issues',
		},
		homepage: 'https://github.com/Geequlim/voice-brief#readme',
		main: './index.js',
		bin: {
			'voice-brief': './index.bin.js',
		},
		engines: {
			node: '>=24.0.0',
		},
		files: [...SHIPPED_FILES, 'README.md', 'LICENSE'],
		dependencies,
	};

	fs.rmSync(stagingDirectory, { recursive: true, force: true });
	fs.mkdirSync(stagingDirectory, { recursive: true });
	for (const file of SHIPPED_FILES) {
		fs.copyFileSync(path.join(buildDirectory, file), path.join(stagingDirectory, file));
	}
	fs.copyFileSync(path.join(workspace, 'README.md'), path.join(stagingDirectory, 'README.md'));
	fs.copyFileSync(path.join(workspace, 'LICENSE'), path.join(stagingDirectory, 'LICENSE'));
	fs.writeFileSync(path.join(stagingDirectory, 'package.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	// 占位锁文件使 staging 被视为独立项目，随后填充真实解析记录
	fs.writeFileSync(path.join(stagingDirectory, 'yarn.lock'), '\n');
	fs.chmodSync(path.join(stagingDirectory, 'index.bin.js'), 0o755);

	// npm publish 需要锁文件里有本包的解析记录；update-lockfile 模式只生成锁文件，不安装链接
	const yarnRelease = path.join(workspace, '.yarn', 'releases', 'yarn-4.17.1.cjs');
	const lockfile = spawnSync(process.execPath, [yarnRelease, 'install', '--mode=update-lockfile'], {
		cwd: stagingDirectory,
		stdio: 'inherit',
		env: { ...process.env, YARN_ENABLE_TELEMETRY: '0' },
	});
	if (lockfile.status !== 0) fail('staging lockfile 生成失败');

	console.log(`[package-cli] staging 组装完成: ${path.relative(workspace, stagingDirectory)}`);
	console.log(`[package-cli] external 依赖: ${Object.entries(dependencies).map(([name, spec]) => `${name}@${spec}`).join(', ')}`);
}

main();

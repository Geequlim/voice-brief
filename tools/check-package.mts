import fs from 'node:fs';
import path from 'node:path';

/**
 * 产物与工程卫生检查，供 lint selector 与 CI 调用：
 * - staging 目录白名单与 manifest 一致性
 * - lockfile 只使用默认公网 registry
 * - 配置文件不含本机绝对路径
 */

const workspace = path.resolve(import.meta.dirname, '..');
const problems: string[] = [];

function checkManifests() {
	const staging = [path.join(workspace, 'dist', 'npm', 'voice-brief', 'package.json'), path.join(workspace, 'dist', 'npm', 'voice-brief-cinnamon', 'package.json')];
	for (const file of staging) {
		if (!fs.existsSync(file)) continue;
		const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { license?: string; private?: boolean };
		if (manifest.license !== 'MIT') {
			problems.push(`staging manifest 缺少 MIT 声明: ${path.relative(workspace, file)}`);
		}
		if (manifest.private === true) {
			problems.push(`staging manifest 不得标记 private: ${path.relative(workspace, file)}`);
		}
	}
}

function checkLockfile() {
	const lockfile = path.join(workspace, 'yarn.lock');
	if (!fs.existsSync(lockfile)) {
		problems.push('缺少 yarn.lock');
		return;
	}
	const text = fs.readFileSync(lockfile, 'utf8');
	// 默认 npmjs registry 的解析不会写出 URL；出现 http 端点即视为镜像或私有源
	for (const line of text.split('\n')) {
		if (line.trim().startsWith('resolution:') && /https?:\/\//.test(line)) {
			problems.push(`yarn.lock 存在非默认 registry 解析: ${line.trim()}`);
		}
	}
}

function checkStagingWhitelist() {
	const cliStaging = path.join(workspace, 'dist', 'npm', 'voice-brief');
	if (!fs.existsSync(path.join(cliStaging, 'package.json'))) return;
	const allowed = new Set(['index.js', 'index.bin.js', 'dependencies.js', 'package.json', 'README.md', 'LICENSE', 'yarn.lock', 'package.tgz']);
	for (const entry of fs.readdirSync(cliStaging)) {
		if (!allowed.has(entry)) {
			problems.push(`CLI staging 含白名单外文件: ${entry}`);
		}
	}
	const manifest = JSON.parse(fs.readFileSync(path.join(cliStaging, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; files?: string[] };
	const files = manifest.files ?? [];
	if (files.length && JSON.stringify(files.slice(0, 3)) !== JSON.stringify(['index.js', 'index.bin.js', 'dependencies.js'])) {
		problems.push('CLI staging manifest files 白名单与产物结构不一致');
	}
	const dependencies = Object.keys(manifest.dependencies ?? {});
	if (dependencies.length === 0) {
		problems.push('CLI staging manifest 缺少运行时依赖声明');
	}
	const bundle = fs.readFileSync(path.join(cliStaging, 'index.js'), 'utf8') + fs.readFileSync(path.join(cliStaging, 'dependencies.js'), 'utf8');
	for (const name of dependencies) {
		if (!bundle.includes(`require("${name}`)) {
			problems.push(`manifest 依赖 ${name} 未在产物中以 external 形式出现`);
		}
	}
}

function checkConfigsHaveNoLocalPaths() {
	const configFiles = ['rspack.config.mts', 'vitest.config.mts', 'eslint.config.mjs', 'oxlint.config.mts', 'tsconfig.json', 'project.tiny'];
	for (const file of configFiles) {
		const full = path.join(workspace, file);
		if (!fs.existsSync(full)) continue;
		const text = fs.readFileSync(full, 'utf8');
		if (/\/home\/|\/Users\/|[A-Z]:\\\\/.test(text)) {
			problems.push(`配置文件包含本机绝对路径: ${file}`);
		}
	}
}

checkManifests();
checkLockfile();
checkStagingWhitelist();
checkConfigsHaveNoLocalPaths();

if (problems.length) {
	console.error('[check-package] 发现问题:');
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log('[check-package] 产物与工程卫生检查通过');

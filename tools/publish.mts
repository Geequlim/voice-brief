import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const workspace = path.resolve(import.meta.dirname, '..');

function fail(message: string): never {
	console.error(`[publish] ${message}`);
	process.exit(1);
}

const target = process.argv[2];
if (!target) fail('用法: node tools/publish.mts <staging 目录> [额外的 yarn 参数，如 --dry-run]');

const staging = path.resolve(workspace, target);
if (!fs.existsSync(path.join(staging, 'package.json'))) {
	fail(`staging 目录无效（缺少 package.json）: ${staging}`);
}

const yarnRelease = path.join(workspace, '.yarn', 'releases', 'yarn-4.17.1.cjs');
const extraArgs = process.argv.slice(3);
const result = spawnSync(process.execPath, [yarnRelease, 'npm', 'publish', '--access', 'public', ...extraArgs], {
	cwd: staging,
	stdio: 'inherit',
	env: { ...process.env, YARN_ENABLE_TELEMETRY: '0' },
});
process.exit(result.status ?? 1);

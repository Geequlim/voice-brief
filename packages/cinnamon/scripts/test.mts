import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const workspaceDirectory = fileURLToPath(new URL('../../..', import.meta.url));

execFileSync('node', ['scripts/build.mts'], { cwd: packageDirectory, stdio: 'inherit' });
execFileSync('yarn', ['tsc', '-p', `${packageDirectory}/tsconfig.test.json`], {
	cwd: workspaceDirectory,
	stdio: 'inherit',
});
execFileSync('gjs', [fileURLToPath(new URL('../dist/tests/tests/hook-server.gjs.js', import.meta.url))], {
	cwd: packageDirectory,
	stdio: 'inherit',
});

import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const workspaceDirectory = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../dist/voice-brief@tinyaxis', import.meta.url));
const assetDirectory = fileURLToPath(new URL('../assets', import.meta.url));

await rm(outputDirectory, { recursive: true, force: true });
execFileSync('yarn', ['tsc', '-p', `${packageDirectory}/tsconfig.json`], {
	cwd: workspaceDirectory,
	stdio: 'inherit',
});
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
	cp(`${assetDirectory}/metadata.json`, `${outputDirectory}/metadata.json`),
	cp(`${assetDirectory}/settings-schema.json`, `${outputDirectory}/settings-schema.json`),
	cp(`${assetDirectory}/stylesheet.css`, `${outputDirectory}/stylesheet.css`),
]);

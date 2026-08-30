import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = 'voice-brief@tinyaxis';
const sourceDirectory = fileURLToPath(new URL(`../dist/${UUID}`, import.meta.url));
const extensionRoot = join(homedir(), '.local', 'share', 'cinnamon', 'extensions');
const targetDirectory = join(extensionRoot, UUID);

await readFile(join(sourceDirectory, 'metadata.json'));
await mkdir(extensionRoot, { recursive: true });
await rm(targetDirectory, { recursive: true, force: true });
await cp(sourceDirectory, targetDirectory, { recursive: true });
console.log(`Installed ${UUID} to ${targetDirectory}`);

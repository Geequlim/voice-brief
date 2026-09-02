import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoiceBriefConfigService } from '../src/config/services/config-service.ts';
import type { VoiceBriefConfigModule } from '../src/config/index.ts';
import type { VoiceBriefPaths } from '../src/config/types.ts';
import { AudioCppAlignmentProvider } from '../src/runtime/alignment-providers/audiocpp-alignment-provider.ts';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const fixtureDir = path.join(workspace, 'tests', 'fixtures');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-alignment-smoke-'));
const paths: VoiceBriefPaths = {
	configDir: tempDir,
	configFile: path.join(tempDir, 'config.yaml'),
	personaDir: path.join(tempDir, 'personas'),
	stateDir: path.join(tempDir, 'state'),
	stateFile: path.join(tempDir, 'state.yaml'),
	cacheDir: path.join(tempDir, 'cache'),
	tempDir,
};

try {
	const config = new VoiceBriefConfigService({} as VoiceBriefConfigModule).createDefaultConfig();
	config.alignment = {
		enabled: true,
		provider: 'audiocpp',
		audiocpp: {
			baseUrl: process.env['VOICE_BRIEF_ALIGNMENT_BASE_URL'] ?? 'http://127.0.0.1:8080/v1',
			model: process.env['VOICE_BRIEF_ALIGNMENT_MODEL'] ?? 'qwen3-align',
			language: process.env['VOICE_BRIEF_ALIGNMENT_LANGUAGE'] ?? 'zh',
			timeoutMs: 120000,
		},
	};
	const text = (await fs.readFile(path.join(fixtureDir, '甜妹助理.txt'), 'utf-8')).trim();
	const alignment = await new AudioCppAlignmentProvider().align({
		audioFile: path.join(fixtureDir, '甜妹助理.mp3'),
		config,
		paths,
		text,
	});
	if (alignment.cues.length === 0) throw new Error('alignment smoke 未返回任何 cue');
	const lastCue = alignment.cues.at(-1)!;
	console.log(`[voice-brief] alignment smoke passed: ${alignment.cues.length} cues, ${Math.round(lastCue.endMs)} ms`);
} finally {
	await fs.rm(tempDir, { recursive: true, force: true });
}

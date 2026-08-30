import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpeechAlignment } from '../../../src/runtime/alignment.mts';

type SmokeScenarioName = 'all' | 'dialogue' | 'entrance' | 'karaoke' | 'multiline' | 'no-session' | 'queue';
type HookEventName =
	| 'playback.completed'
	| 'playback.queued'
	| 'playback.ready'
	| 'playback.started';

interface SmokeScenario {
	name: Exclude<SmokeScenarioName, 'all'>;
	description: string;
	text: string;
	session?: string;
}

interface SmokePersona {
	name: string;
	avatar?: string;
	color?: string;
}

interface AlignmentFixture {
	text: string;
	words: Array<{
		word: string;
		start_sample: number;
		end_sample: number;
	}>;
}

const DEFAULT_PERSONA_PATH = join(homedir(), '.config', 'voice-brief', 'personas', '甜妹助理.md');
const DEFAULT_SOCKET_PATH = join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 0}`, 'voice-brief', 'cinnamon.sock');
const WORKSPACE_DIRECTORY = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURE_DIRECTORY = join(WORKSPACE_DIRECTORY, 'tests', 'fixtures');
const scenarioName = process.argv[2] ?? 'all';
const scenarios: ReadonlyArray<SmokeScenario> = [
	{
		name: 'karaoke',
		description: '暂存音频与逐字时间轴的完整 KTV 冒烟测试',
		text: '',
		session: 'KTV 逐字 fixture 冒烟测试',
	},
	{
		name: 'entrance',
		description: '播放就绪后的头像与完整对话入场动画',
		text: '这条消息用于检查播放就绪之后的头像与完整对话入场动画。',
		session: 'Cinnamon 入场动画冒烟测试',
	},
	{
		name: 'dialogue',
		description: '头像与完整对话展开',
		text: '这是一条标准对话展开冒烟测试，用来观察展示就绪后的头像和完整卡片动画衔接。',
		session: 'Cinnamon 标准展开冒烟测试',
	},
	{
		name: 'multiline',
		description: '显式换行与长文本自适应高度',
		text: '第一行用于检查显式换行。\n第二行是一段更长的内容，用来确认文本会在可用宽度内继续自动换行，并且卡片高度能够根据完整内容自然增长，不会裁切播报正文。',
		session: 'Cinnamon 多行内容冒烟测试',
	},
	{
		name: 'no-session',
		description: '没有会话名称时使用模型信息回退',
		text: '这个场景没有传递会话名称，应当由 Agent 和模型信息填充标题位置。',
	},
	{
		name: 'queue',
		description: '连续播报原位交接与内容替换强调',
		text: '连续播报的第一条内容。下一条已经进入播放队列，结束时面板应当保持可见。',
		session: 'Cinnamon 连续播报冒烟测试',
	},
];

if (!isSmokeScenarioName(scenarioName)) {
	throw new Error(`未知场景 ${scenarioName}，可用场景：all、entrance、dialogue、karaoke、multiline、no-session、queue`);
}

const socketPath = process.env.VOICE_BRIEF_CINNAMON_SOCKET ?? DEFAULT_SOCKET_PATH;
const personaPath = process.env.VOICE_BRIEF_SMOKE_PERSONA ?? DEFAULT_PERSONA_PATH;
await access(socketPath);
const persona = await loadPersona(personaPath);
const selectedScenarios = scenarioName === 'all'
	? scenarios.filter(scenario => scenario.name !== 'karaoke')
	: scenarios.filter(scenario => scenario.name === scenarioName);

for (const [index, scenario] of selectedScenarios.entries()) {
	console.log(`[voice-brief] smoke ${scenario.name}: ${scenario.description}`);
	await runScenario(socketPath, persona, scenario);
	if (index < selectedScenarios.length - 1) await delay(700);
}

function isSmokeScenarioName(value: string): value is SmokeScenarioName {
	return ['all', 'entrance', 'dialogue', 'karaoke', 'multiline', 'no-session', 'queue'].includes(value);
}

async function loadPersona(path: string): Promise<SmokePersona> {
	const document = await readFile(path, 'utf8');
	const frontmatter = document.match(/^---\n([\s\S]*?)\n---/)?.[1];
	const name = document.match(/^#\s+(.+)$/m)?.[1] ?? 'Voice Brief';
	if (!frontmatter) return { name };

	const avatar = readFrontmatterField(frontmatter, 'avatar');
	const color = readFrontmatterField(frontmatter, 'color');
	return {
		name,
		avatar: avatar ? resolve(dirname(path), avatar) : undefined,
		color,
	};
}

function readFrontmatterField(frontmatter: string, field: string): string | undefined {
	const value = new RegExp(`^${field}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]?.trim();
	if (!value) return undefined;
	const quote = value[0];
	if ((quote === '"' || quote === "'") && value.at(-1) === quote) return value.slice(1, -1);
	return value;
}

async function runScenario(socketPath: string, persona: SmokePersona, scenario: SmokeScenario): Promise<void> {
	if (scenario.name === 'karaoke') {
		await runKaraokeScenario(socketPath, persona, scenario);
		return;
	}
	if (scenario.name === 'queue') {
		await runQueueScenario(socketPath, persona, scenario);
		return;
	}
	const briefId = randomUUID();
	let sequence = 1;
	const source = {
		agent: 'Codex',
		model: 'GPT 5.6 Sol',
		session: scenario.session,
	};
	const send = async (event: HookEventName): Promise<void> => {
		const payload = {
			protocol: 'voice-brief.hook-event',
			version: 2,
			eventId: randomUUID(),
			occurredAt: new Date().toISOString(),
			briefId,
			event,
			sequence,
			brief: {
				text: scenario.text,
				kind: 'test',
				priority: 'normal',
			},
			source,
			persona,
		};
		sequence += 1;
		await sendEvent(socketPath, payload);
	};

	await send('playback.queued');
	await send('playback.ready');
	await delay(1500);
	await send('playback.started');
	await delay(5000);
	await send('playback.completed');
	await delay(350);
}

async function runKaraokeScenario(socketPath: string, persona: SmokePersona, scenario: SmokeScenario): Promise<void> {
	const [text, rawFixture] = await Promise.all([
		readFile(join(FIXTURE_DIRECTORY, '甜妹助理.txt'), 'utf8'),
		readFile(join(FIXTURE_DIRECTORY, '甜妹助理.json'), 'utf8'),
	]);
	const fixture = JSON.parse(rawFixture) as AlignmentFixture;
	if (fixture.text !== text.trim()) throw new Error('KTV fixture 的 JSON 与 TXT 原文不一致');
	const alignment = createSpeechAlignment({
		source: 'fixture',
		text: fixture.text,
		sampleRate: 16_000,
		cues: fixture.words.map(word => ({
			text: word.word,
			startSample: word.start_sample,
			endSample: word.end_sample,
		})),
	});
	const briefId = randomUUID();
	const audio = {
		provider: 'fixture',
		source: 'provider' as const,
		durationMs: alignment.cues.at(-1)?.endMs ?? 0,
		alignment,
	};
	let sequence = 1;
	const send = async (event: HookEventName): Promise<void> => {
		await sendEvent(socketPath, {
			protocol: 'voice-brief.hook-event',
			version: 2,
			eventId: randomUUID(),
			occurredAt: new Date().toISOString(),
			briefId,
			event,
			sequence,
			brief: { text: fixture.text, kind: 'test', priority: 'normal' },
			source: { agent: 'Codex', model: 'Fixture', session: scenario.session },
			persona,
			audio,
		});
		sequence += 1;
	};

	await send('playback.queued');
	await send('playback.ready');
	await delay(1500);
	const player = process.env.VOICE_BRIEF_KARAOKE_PLAYER ?? 'mpv';
	const child = spawn(player, [
		'--no-video',
		'--really-quiet',
		'--keep-open=no',
		'--audio-client-name=voice-brief-cinnamon-smoke',
		join(FIXTURE_DIRECTORY, '甜妹助理.mp3'),
	], {
		stdio: 'ignore',
	});
	await Promise.race([
		once(child, 'spawn'),
		once(child, 'error').then(([error]) => Promise.reject(error)),
	]);
	await send('playback.started');
	const [exitCode] = await once(child, 'close') as [number | null];
	if (exitCode !== 0) throw new Error(`${player} 播放 fixture 失败，退出码: ${exitCode ?? 'unknown'}`);
	await send('playback.completed');
	await delay(350);
}

async function runQueueScenario(socketPath: string, persona: SmokePersona, scenario: SmokeScenario): Promise<void> {
	const firstBriefId = randomUUID();
	const secondBriefId = randomUUID();
	const source = {
		agent: 'Codex',
		model: 'GPT 5.6 Sol',
		session: scenario.session,
	};
	const send = async (briefId: string, event: HookEventName, sequence: number, text: string): Promise<void> => {
		await sendEvent(socketPath, {
			protocol: 'voice-brief.hook-event',
			version: 2,
			eventId: randomUUID(),
			occurredAt: new Date().toISOString(),
			briefId,
			event,
			sequence,
			brief: {
				text,
				kind: 'test',
				priority: 'normal',
			},
			source,
			persona,
		});
	};
	const secondText = '连续播报的第二条内容已经开始。面板不应消失，只需原位更新文字并播放一次整体缩放强调。';

	await send(firstBriefId, 'playback.queued', 1, scenario.text);
	await send(firstBriefId, 'playback.ready', 2, scenario.text);
	await delay(1500);
	await send(firstBriefId, 'playback.started', 3, scenario.text);
	await delay(1800);
	await send(secondBriefId, 'playback.queued', 1, secondText);
	await delay(1200);
	await send(firstBriefId, 'playback.completed', 4, scenario.text);
	await delay(350);
	await send(secondBriefId, 'playback.ready', 2, secondText);
	await delay(1500);
	await send(secondBriefId, 'playback.started', 3, secondText);
	await delay(3500);
	await send(secondBriefId, 'playback.completed', 4, secondText);
	await delay(350);
}

async function sendEvent(socketPath: string, event: object): Promise<void> {
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const socket = createConnection(socketPath);
		socket.once('connect', () => socket.end(`${JSON.stringify(event)}\n`));
		socket.once('error', rejectPromise);
		socket.once('close', hadError => {
			if (!hadError) resolvePromise();
		});
	});
}

async function delay(durationMs: number): Promise<void> {
	await new Promise(resolvePromise => setTimeout(resolvePromise, durationMs));
}

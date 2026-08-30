import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createSpeechAlignment } from '../src/runtime/alignment.mts';

interface Fixture {
	text: string;
	words: Array<{
		word: string;
		start_sample: number;
		end_sample: number;
	}>;
}

describe('Speech alignment', () => {
	test('将逐字 fixture 标准化为毫秒和原文位置', async () => {
		const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', '甜妹助理.json');
		const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8')) as Fixture;
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

		expect(alignment.cues).toHaveLength(63);
		expect(alignment.cues[0]).toEqual({ text: '哎', startMs: 240, endMs: 400, startChar: 0, endChar: 1 });
		expect(alignment.cues.at(-1)).toMatchObject({ text: '啊', startMs: 11840, endMs: 11920 });
		expect(alignment.cues.find(cue => cue.text === '福' && cue.startMs === 3840)).toMatchObject({ startChar: 25, endChar: 26 });
	});

	test('拒绝无法匹配原文或时间倒退的 cue', () => {
		expect(() => createSpeechAlignment({
			source: 'fixture',
			text: '任务完成',
			sampleRate: 16_000,
			cues: [{ text: '不存在', startSample: 0, endSample: 1 }],
		})).toThrow('无法匹配原文');
		expect(() => createSpeechAlignment({
			source: 'fixture',
			text: '任务完成',
			sampleRate: 16_000,
			cues: [
				{ text: '任', startSample: 16, endSample: 32 },
				{ text: '务', startSample: 8, endSample: 16 },
			],
		})).toThrow('时间顺序无效');
	});
});

import type { SpeechAlignment, SpeechAlignmentCue } from './types';

export interface SampledSpeechAlignmentCue {
	endSample: number;
	text: string;
	startSample: number;
}

export interface SampledSpeechAlignmentInput {
	cues: SampledSpeechAlignmentCue[];
	sampleRate: number;
	source: string;
	text: string;
}

export interface TimedSpeechAlignmentCue {
	endMs: number;
	text: string;
	startMs: number;
}

export interface TimedSpeechAlignmentInput {
	cues: TimedSpeechAlignmentCue[];
	source: string;
	text: string;
}

export function createSpeechAlignment(input: SampledSpeechAlignmentInput): SpeechAlignment {
	if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) throw new Error('alignment sampleRate 必须为正数');
	return createTimedSpeechAlignment({
		...input,
		cues: input.cues.map(cue => ({
			text: cue.text,
			startMs: cue.startSample / input.sampleRate * 1_000,
			endMs: cue.endSample / input.sampleRate * 1_000,
		})),
	});
}

export function createTimedSpeechAlignment(input: TimedSpeechAlignmentInput): SpeechAlignment {
	let textOffset = 0;
	let previousEndMs = 0;
	const cues: SpeechAlignmentCue[] = [];
	for (const rawCue of input.cues) {
		if (!rawCue.text) throw new Error('alignment cue.text 不能为空');
		if (!Number.isFinite(rawCue.startMs) || !Number.isFinite(rawCue.endMs) || rawCue.startMs < 0 || rawCue.endMs < rawCue.startMs) {
			throw new Error(`alignment cue ${rawCue.text} 的时间无效`);
		}
		const startChar = input.text.indexOf(rawCue.text, textOffset);
		if (startChar === -1) throw new Error(`alignment cue 无法匹配原文: ${rawCue.text}`);
		const { startMs, endMs } = rawCue;
		if (startMs < previousEndMs) throw new Error(`alignment cue ${rawCue.text} 的时间顺序无效`);
		cues.push({
			text: rawCue.text,
			startMs,
			endMs,
			startChar,
			endChar: startChar + rawCue.text.length,
		});
		textOffset = startChar + rawCue.text.length;
		previousEndMs = endMs;
	}
	return { source: input.source, cues };
}

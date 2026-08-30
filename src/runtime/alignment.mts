import type { SpeechAlignment, SpeechAlignmentCue } from './types.ts';

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

export function createSpeechAlignment(input: SampledSpeechAlignmentInput): SpeechAlignment {
	if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) throw new Error('alignment sampleRate 必须为正数');
	let textOffset = 0;
	let previousEndMs = 0;
	const cues: SpeechAlignmentCue[] = [];
	for (const rawCue of input.cues) {
		if (!rawCue.text) throw new Error('alignment cue.text 不能为空');
		if (!Number.isFinite(rawCue.startSample) || !Number.isFinite(rawCue.endSample) || rawCue.startSample < 0 || rawCue.endSample < rawCue.startSample) {
			throw new Error(`alignment cue ${rawCue.text} 的采样时间无效`);
		}
		const startChar = input.text.indexOf(rawCue.text, textOffset);
		if (startChar === -1) throw new Error(`alignment cue 无法匹配原文: ${rawCue.text}`);
		const startMs = rawCue.startSample / input.sampleRate * 1_000;
		const endMs = rawCue.endSample / input.sampleRate * 1_000;
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

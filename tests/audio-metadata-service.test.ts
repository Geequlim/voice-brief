import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import { VoiceBriefAudioMetadataService } from '../src/runtime/services/audio-metadata-service';

async function createTempDir() {
	return fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-audio-meta-'));
}

function createWavBuffer(durationMs: number) {
	const sampleRate = 8_000;
	const channelCount = 1;
	const bitsPerSample = 16;
	const byteRate = sampleRate * channelCount * bitsPerSample / 8;
	const blockAlign = channelCount * bitsPerSample / 8;
	const dataSize = Math.round(byteRate * durationMs / 1_000);
	const buffer = Buffer.alloc(44 + dataSize);

	buffer.write('RIFF', 0, 'ascii');
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write('WAVE', 8, 'ascii');
	buffer.write('fmt ', 12, 'ascii');
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(byteRate, 28);
	buffer.writeUInt16LE(blockAlign, 32);
	buffer.writeUInt16LE(bitsPerSample, 34);
	buffer.write('data', 36, 'ascii');
	buffer.writeUInt32LE(dataSize, 40);

	return buffer;
}

function createMp3Buffer(durationMs: number) {
	const bitrate = 128_000;
	const fileSize = Math.round(durationMs * bitrate / 8_000);
	const buffer = Buffer.alloc(fileSize, 0);
	buffer[0] = 0xff;
	buffer[1] = 0xfb;
	buffer[2] = 0x90;
	buffer[3] = 0x00;
	return buffer;
}

describe('VoiceBriefAudioMetadataService', () => {
	test('可以读取 wav 文件时长', async () => {
		const root = await createTempDir();
		const audioFile = path.join(root, 'sample.wav');
		await fs.writeFile(audioFile, createWavBuffer(1_500));
		const service = new VoiceBriefAudioMetadataService({} as VoiceBriefRuntimeModule);

		await expect(service.getAudioDurationMs(audioFile)).resolves.toBe(1_500);
	});

	test('可以读取 mp3 文件时长', async () => {
		const root = await createTempDir();
		const audioFile = path.join(root, 'sample.mp3');
		await fs.writeFile(audioFile, createMp3Buffer(2_000));
		const service = new VoiceBriefAudioMetadataService({} as VoiceBriefRuntimeModule);

		await expect(service.getAudioDurationMs(audioFile)).resolves.toBe(2_000);
	});
});

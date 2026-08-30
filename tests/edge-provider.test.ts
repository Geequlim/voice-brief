import { describe, expect, test } from 'vitest';
import { EdgeProvider } from '../src/runtime/providers/edge-provider';
import type { VoiceBriefRuntimeModule } from '../src/runtime';

interface EdgeProviderInternals {
	extractAudioChunk(data: Buffer): Buffer | undefined;
}

describe('voice-brief edge provider', () => {
	test('从 Edge 二进制帧中提取完整 mp3 payload', () => {
		const provider = new EdgeProvider({} as VoiceBriefRuntimeModule) as unknown as EdgeProviderInternals;
		const headers = Buffer.from('Path:audio\r\nContent-Type:audio/mpeg\r\n');
		const prefix = Buffer.alloc(2);
		const audio = Buffer.from([0xff, 0xf3, 0x64, 0xc4, 0x00, 0x00]);

		prefix.writeUInt16BE(headers.length);
		const frame = Buffer.concat([prefix, headers, audio]);

		expect(provider.extractAudioChunk(frame)).toEqual(audio);
	});
});

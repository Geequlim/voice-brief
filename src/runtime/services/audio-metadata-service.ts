import fs from 'node:fs/promises';
import path from 'node:path';
import type { VoiceBriefRuntimeModule } from '../index';

type MpegVersion = '1' | '2' | '2.5';
type MpegLayer = 'I' | 'II' | 'III';

interface Mp3FrameHeader {
	version: MpegVersion;
	layer: MpegLayer;
	bitrateKbps: number;
	sampleRate: number;
	channelMode: number;
	samplesPerFrame: number;
}

export class VoiceBriefAudioMetadataService {
	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async getAudioDurationMs(audioFile: string) {
		const extension = path.extname(audioFile).toLowerCase();
		if (extension === '.mp3') return this.getMp3DurationMs(audioFile);
		if (extension === '.wav') return this.getWavDurationMs(audioFile);
		return undefined;
	}

	private async getMp3DurationMs(audioFile: string) {
		const data = await fs.readFile(audioFile);
		const headerOffset = this.findMp3FrameOffset(data);
		if (headerOffset === undefined) return undefined;
		const header = this.parseMp3FrameHeader(data, headerOffset);
		if (!header) return undefined;

		const xingDurationMs = this.readXingDurationMs(data, headerOffset, header);
		if (xingDurationMs !== undefined) return xingDurationMs;

		const vbriDurationMs = this.readVbriDurationMs(data, headerOffset, header);
		if (vbriDurationMs !== undefined) return vbriDurationMs;

		const id3v2Size = this.readId3v2Size(data);
		const id3v1Size = this.hasId3v1Tag(data) ? 128 : 0;
		const audioBytes = data.length - id3v2Size - id3v1Size;
		if (audioBytes <= 0) return undefined;
		return Math.round(audioBytes * 8_000 / (header.bitrateKbps * 1_000));
	}

	private async getWavDurationMs(audioFile: string) {
		const data = await fs.readFile(audioFile);
		if (data.length < 12) return undefined;
		if (data.toString('ascii', 0, 4) !== 'RIFF') return undefined;
		if (data.toString('ascii', 8, 12) !== 'WAVE') return undefined;

		let offset = 12;
		let byteRate: number | undefined;
		let dataSize: number | undefined;
		while (offset + 8 <= data.length) {
			const chunkId = data.toString('ascii', offset, offset + 4);
			const chunkSize = data.readUInt32LE(offset + 4);
			const chunkDataOffset = offset + 8;
			if (chunkDataOffset + chunkSize > data.length) return undefined;

			if (chunkId === 'fmt ') {
				if (chunkSize < 16) return undefined;
				byteRate = data.readUInt32LE(chunkDataOffset + 8);
			}
			if (chunkId === 'data') {
				dataSize = chunkSize;
			}
			if (byteRate && dataSize !== undefined) {
				if (byteRate <= 0) return undefined;
				return Math.round(dataSize * 1_000 / byteRate);
			}

			offset = chunkDataOffset + chunkSize + (chunkSize % 2);
		}

		return undefined;
	}

	private findMp3FrameOffset(data: Buffer) {
		const start = this.readId3v2Size(data);
		for (let offset = start; offset + 4 <= data.length; offset += 1) {
			if (this.parseMp3FrameHeader(data, offset)) return offset;
		}
		return undefined;
	}

	private parseMp3FrameHeader(data: Buffer, offset: number) {
		if (offset + 4 > data.length) return undefined;
		const header = data.readUInt32BE(offset);
		if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return undefined;

		const versionBits = (header >>> 19) & 0b11;
		const layerBits = (header >>> 17) & 0b11;
		const bitrateIndex = (header >>> 12) & 0b1111;
		const sampleRateIndex = (header >>> 10) & 0b11;
		const channelMode = (header >>> 6) & 0b11;

		const version = this.parseMpegVersion(versionBits);
		const layer = this.parseMpegLayer(layerBits);
		if (!version || !layer) return undefined;
		if (bitrateIndex === 0 || bitrateIndex === 0b1111) return undefined;
		if (sampleRateIndex === 0b11) return undefined;

		const bitrateKbps = this.resolveBitrateKbps(version, layer, bitrateIndex);
		const sampleRate = this.resolveSampleRate(version, sampleRateIndex);
		const samplesPerFrame = this.resolveSamplesPerFrame(version, layer);
		if (!bitrateKbps || !sampleRate || !samplesPerFrame) return undefined;

		return {
			version,
			layer,
			bitrateKbps,
			sampleRate,
			channelMode,
			samplesPerFrame,
		} satisfies Mp3FrameHeader;
	}

	private parseMpegVersion(versionBits: number): MpegVersion | undefined {
		if (versionBits === 0b11) return '1';
		if (versionBits === 0b10) return '2';
		if (versionBits === 0b00) return '2.5';
		return undefined;
	}

	private parseMpegLayer(layerBits: number): MpegLayer | undefined {
		if (layerBits === 0b11) return 'I';
		if (layerBits === 0b10) return 'II';
		if (layerBits === 0b01) return 'III';
		return undefined;
	}

	private resolveBitrateKbps(version: MpegVersion, layer: MpegLayer, bitrateIndex: number) {
		const bitrates = version === '1'
			? {
				I: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
				II: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
				III: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
			}
			: {
				I: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
				II: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
				III: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
			};
		return bitrates[layer][bitrateIndex];
	}

	private resolveSampleRate(version: MpegVersion, sampleRateIndex: number) {
		if (version === '1') return [44_100, 48_000, 32_000][sampleRateIndex];
		if (version === '2') return [22_050, 24_000, 16_000][sampleRateIndex];
		return [11_025, 12_000, 8_000][sampleRateIndex];
	}

	private resolveSamplesPerFrame(version: MpegVersion, layer: MpegLayer) {
		if (layer === 'I') return 384;
		if (layer === 'II') return 1_152;
		return version === '1' ? 1_152 : 576;
	}

	private readXingDurationMs(data: Buffer, headerOffset: number, header: Mp3FrameHeader) {
		const markerOffset = headerOffset + 4 + this.sideInfoSize(header.version, header.channelMode);
		if (markerOffset + 12 > data.length) return undefined;
		const marker = data.toString('ascii', markerOffset, markerOffset + 4);
		if (marker !== 'Xing' && marker !== 'Info') return undefined;
		const flags = data.readUInt32BE(markerOffset + 4);
		if ((flags & 0x1) === 0) return undefined;
		const frameCount = data.readUInt32BE(markerOffset + 8);
		return Math.round(frameCount * header.samplesPerFrame * 1_000 / header.sampleRate);
	}

	private readVbriDurationMs(data: Buffer, headerOffset: number, header: Mp3FrameHeader) {
		const markerOffset = headerOffset + 36;
		if (markerOffset + 18 > data.length) return undefined;
		if (data.toString('ascii', markerOffset, markerOffset + 4) !== 'VBRI') return undefined;
		const frameCount = data.readUInt32BE(markerOffset + 14);
		return Math.round(frameCount * header.samplesPerFrame * 1_000 / header.sampleRate);
	}

	private sideInfoSize(version: MpegVersion, channelMode: number) {
		const mono = channelMode === 0b11;
		if (version === '1') return mono ? 17 : 32;
		return mono ? 9 : 17;
	}

	private readId3v2Size(data: Buffer) {
		if (data.length < 10) return 0;
		if (data.toString('ascii', 0, 3) !== 'ID3') return 0;
		return 10
			+ ((data[6] & 0x7f) << 21)
			+ ((data[7] & 0x7f) << 14)
			+ ((data[8] & 0x7f) << 7)
			+ (data[9] & 0x7f);
	}

	private hasId3v1Tag(data: Buffer) {
		if (data.length < 128) return false;
		return data.toString('ascii', data.length - 128, data.length - 125) === 'TAG';
	}
}

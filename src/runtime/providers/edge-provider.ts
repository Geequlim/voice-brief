import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { WebSocket } from 'ws';
import type { VoiceBriefConfig } from '../../config/schema';
import type { VoicePersona } from '../../persona/types';
import type { ProviderCacheDescriptor, ProviderCheckResult, SynthesizeInput, SynthesizeResult, TtsProvider } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';
import type { RawData } from 'ws';

export class EdgeProvider implements TtsProvider {
	readonly id = 'edge';

	private readonly $chromiumFullVersion = '143.0.3650.75';
	private readonly $trustedClientToken = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
	private readonly $origin = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
	private readonly $outputFormat = 'audio-24khz-48kbitrate-mono-mp3';
	private readonly $timeoutMs = 30000;

	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async check(): Promise<ProviderCheckResult> {
		return {
			ok: true,
			message: '内置 Edge TTS provider 可用，无需 Python 或 API Key',
		};
	}

	getCacheDescriptor(input: SynthesizeInput): ProviderCacheDescriptor {
		const options = this.getEdgeOptions(input.config, input.persona);
		return {
			extension: 'mp3',
			keyData: {
				rate: options.rate,
				voice: options.voice,
			},
		};
	}

	async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
		const options = this.getEdgeOptions(input.config, input.persona);
		const audioFile = path.join(input.paths.tempDir, `voice-brief-${randomUUID()}.mp3`);
		const audio = await this.requestAudio(input.text, options.voice, options.rate);
		await fs.mkdir(path.dirname(audioFile), { recursive: true });
		await fs.writeFile(audioFile, audio);
		return {
			audioFile,
			provider: this.id,
		};
	}

	private getEdgeOptions(config: VoiceBriefConfig, persona?: VoicePersona) {
		return {
			voice: persona?.edge?.voice || config.providers.edge?.voice || 'zh-CN-XiaoxiaoNeural',
			rate: persona?.edge?.rate || config.providers.edge?.rate || '+8%',
		};
	}

	private requestAudio(text: string, voice: string, rate: string) {
		return new Promise<Buffer>((resolve, reject) => {
			const chunks: Buffer[] = [];
			const socket = new WebSocket(this.createWebSocketUrl(), {
				headers: this.createWebSocketHeaders(),
				agent: this.createProxyAgent(),
			});
			let settled = false;
			const timer = setTimeout(() => finish(new Error('Edge TTS 请求超时')), this.$timeoutMs);
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.close();
				if (error) {
					reject(error);
					return;
				}
				if (chunks.length === 0) {
					reject(new Error('Edge TTS 未返回音频数据'));
					return;
				}
				resolve(Buffer.concat(chunks));
			};

			socket.on('open', () => {
				socket.send(this.createSpeechConfigMessage());
				socket.send(this.createSsmlMessage(text, voice, rate));
			});
			socket.on('message', (data, isBinary) => {
				try {
					if (isBinary) {
						const chunk = this.extractAudioChunk(this.toBuffer(data));
						if (chunk) chunks.push(chunk);
						return;
					}
					const path = this.getTextFramePath(this.toBuffer(data));
					if (path === 'turn.end') finish();
				} catch (error) {
					finish(error instanceof Error ? error : new Error('Edge TTS 响应解析失败'));
				}
			});
			socket.on('error', error => {
				finish(error instanceof Error ? error : new Error('Edge TTS WebSocket 连接失败'));
			});
			socket.on('close', () => {
				if (!settled) finish(new Error('Edge TTS 连接提前关闭'));
			});
		});
	}

	private createWebSocketUrl() {
		const url = new URL('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1');
		url.searchParams.set('TrustedClientToken', this.$trustedClientToken);
		url.searchParams.set('ConnectionId', randomBytes(16).toString('hex'));
		url.searchParams.set('Sec-MS-GEC', this.createSecMsGecToken());
		url.searchParams.set('Sec-MS-GEC-Version', `1-${this.$chromiumFullVersion}`);
		return url.href;
	}

	private createWebSocketHeaders() {
		const majorVersion = this.$chromiumFullVersion.split('.')[0];
		return {
			Pragma: 'no-cache',
			'Cache-Control': 'no-cache',
			Origin: this.$origin,
			'Sec-WebSocket-Version': '13',
			'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Safari/537.36 Edg/${majorVersion}.0.0.0`,
			'Accept-Encoding': 'gzip, deflate, br, zstd',
			'Accept-Language': 'en-US,en;q=0.9',
			Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
		};
	}

	private createSecMsGecToken() {
		const windowsEpoch = 11644473600n;
		const ticksPerSecond = 10000000n;
		const fiveMinuteTicks = 300n * ticksPerSecond;
		const unixSeconds = BigInt(Math.floor(Date.now() / 1000));
		const ticks = (unixSeconds + windowsEpoch) * ticksPerSecond;
		const roundedTicks = ticks - ticks % fiveMinuteTicks;
		const hash = createHash('sha256');
		hash.update(`${roundedTicks}${this.$trustedClientToken}`, 'ascii');
		return hash.digest('hex').toUpperCase();
	}

	private createSpeechConfigMessage() {
		const config = {
			context: {
				synthesis: {
					audio: {
						metadataoptions: {
							sentenceBoundaryEnabled: 'false',
							wordBoundaryEnabled: 'false',
						},
						outputFormat: this.$outputFormat,
					},
				},
			},
		};
		return [
			`X-Timestamp:${this.createTimestamp()}Z`,
			'Content-Type:application/json; charset=utf-8',
			'Path:speech.config',
			'',
			JSON.stringify(config),
		].join('\r\n');
	}

	private createSsmlMessage(text: string, voice: string, rate: string) {
		const locale = this.getVoiceLocale(voice);
		const ssml = [
			`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${this.escapeXml(locale)}">`,
			`<voice name="${this.escapeXml(this.normalizeVoiceName(voice))}">`,
			`<prosody pitch="+0Hz" rate="${this.escapeXml(this.normalizeRate(rate))}" volume="+0%">`,
			this.escapeXml(this.normalizeText(text)),
			'</prosody>',
			'</voice>',
			'</speak>',
		].join('');
		return [
			`X-RequestId:${randomBytes(16).toString('hex')}`,
			'Content-Type:application/ssml+xml',
			`X-Timestamp:${this.createTimestamp()}Z`,
			'Path:ssml',
			'',
			ssml,
		].join('\r\n');
	}

	private normalizeVoiceName(voice: string) {
		if (voice.startsWith('Microsoft Server Speech Text to Speech Voice')) return voice;
		const match = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(voice);
		if (!match) throw new Error(`不支持的 Edge TTS 音色名称: ${voice}`);
		let region = match[2];
		let name = match[3];
		const nameRegionIndex = name.indexOf('-');
		if (nameRegionIndex !== -1) {
			region = `${region}-${name.slice(0, nameRegionIndex)}`;
			name = name.slice(nameRegionIndex + 1);
		}
		return `Microsoft Server Speech Text to Speech Voice (${match[1]}-${region}, ${name})`;
	}

	private getVoiceLocale(voice: string) {
		const longNameMatch = /\(([^,]+),/.exec(voice);
		if (longNameMatch?.[1]) return longNameMatch[1];
		const shortNameMatch = /^([a-z]{2,})-([A-Z]{2,})-/.exec(voice);
		if (!shortNameMatch) throw new Error(`不支持的 Edge TTS 音色名称: ${voice}`);
		return `${shortNameMatch[1]}-${shortNameMatch[2]}`;
	}

	private normalizeRate(rate: string) {
		if (/^[+-]\d+%$/.test(rate)) return rate;
		throw new Error(`不支持的 Edge TTS 语速: ${rate}`);
	}

	private normalizeText(text: string) {
		// oxlint-disable-next-line no-control-regex -- 有意清除 Edge TTS 文本中的控制字符（保留制表符与换行）
		return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
	}

	private escapeXml(text: string) {
		return text.replace(/[<>&"']/g, char => {
			if (char === '<') return '&lt;';
			if (char === '>') return '&gt;';
			if (char === '&') return '&amp;';
			if (char === '"') return '&quot;';
			return '&apos;';
		});
	}

	private createTimestamp() {
		return new Date().toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)');
	}

	private getTextFramePath(data: Buffer) {
		const separator = data.indexOf('\r\n\r\n');
		if (separator === -1) return undefined;
		return this.getHeaderValue(data.subarray(0, separator).toString('utf-8'), 'Path');
	}

	private extractAudioChunk(data: Buffer) {
		return this.extractAudioChunkFromLengthPrefix(data) || this.extractAudioChunkFromPathMarker(data);
	}

	private extractAudioChunkFromLengthPrefix(data: Buffer) {
		if (data.length < 2) return undefined;
		const headerLength = data.readUInt16BE(0);
		const start = 2;
		const end = start + headerLength;
		if (end > data.length) return undefined;
		const headers = data.subarray(start, end).toString('utf-8');
		if (this.getHeaderValue(headers, 'Path') !== 'audio') return undefined;
		const contentType = this.getHeaderValue(headers, 'Content-Type');
		if (contentType && contentType !== 'audio/mpeg') return undefined;
		const audio = data.subarray(end);
		if (audio.length === 0) return undefined;
		return audio;
	}

	private extractAudioChunkFromPathMarker(data: Buffer) {
		const marker = Buffer.from('Path:audio\r\n');
		const index = data.indexOf(marker);
		if (index === -1) return undefined;
		const audio = data.subarray(index + marker.length);
		if (audio.length === 0) return undefined;
		return audio;
	}

	private getHeaderValue(headers: string, name: string) {
		const lowerName = name.toLowerCase();
		const lines = headers.split('\r\n');
		const line = lines.find(item => item.slice(0, name.length + 1).toLowerCase() === `${lowerName}:`);
		return line?.slice(name.length + 1).trim();
	}

	private toBuffer(data: RawData) {
		if (Buffer.isBuffer(data)) return data;
		if (Array.isArray(data)) return Buffer.concat(data);
		return Buffer.from(data);
	}

	private createProxyAgent() {
		const proxyUrl = this.resolveProxyUrl(new URL('wss://speech.platform.bing.com'));
		if (!proxyUrl) return undefined;
		const proxy = new URL(proxyUrl);
		if (proxy.protocol === 'socks:' || proxy.protocol === 'socks4:' || proxy.protocol === 'socks4a:' || proxy.protocol === 'socks5:' || proxy.protocol === 'socks5h:') {
			return new SocksProxyAgent(proxy);
		}
		if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') throw new Error(`不支持的代理协议: ${proxy.protocol}`);
		return new HttpsProxyAgent(proxy);
	}

	private resolveProxyUrl(url: URL) {
		if (this.shouldBypassProxy(url)) return undefined;
		return this.firstEnvValue('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy');
	}

	private shouldBypassProxy(url: URL) {
		const noProxy = this.firstEnvValue('NO_PROXY', 'no_proxy');
		if (!noProxy) return false;
		const hostname = url.hostname.toLowerCase();
		const port = url.port;
		for (const rawEntry of noProxy.split(/[,\s]+/)) {
			const entry = rawEntry.trim().toLowerCase();
			if (!entry) continue;
			if (entry === '*') return true;
			const [host, entryPort] = entry.split(':');
			if (entryPort && entryPort !== port) continue;
			if (host.startsWith('*.') && hostname.endsWith(host.slice(1))) return true;
			if (host.startsWith('.') && hostname.endsWith(host)) return true;
			if (hostname === host) return true;
		}
		return false;
	}

	private firstEnvValue(...names: string[]) {
		for (const name of names) {
			const value = process.env[name];
			if (value) return value;
		}
		return undefined;
	}
}

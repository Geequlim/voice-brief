import type { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import axios from 'axios';
import { isIP } from 'node:net';

export type HttpRequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

export interface HttpRequestOptions {
	responseType?: 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream';
	timeoutMs?: number;
}

export function firstEnvValue(...names: string[]) {
	for (const name of names) {
		const value = process.env[name];
		if (value) return value;
	}
	return undefined;
}

function parseIpAddress(ip: string): { family: 4 | 6; value: bigint; } | undefined {
	if (isIP(ip) === 4) {
		let value = 0n;
		for (const part of ip.split('.')) value = (value << 8n) | BigInt(part);
		return { family: 4, value };
	}
	if (isIP(ip) === 6) {
		const sections = ip.split('::');
		if (sections.length > 2) return undefined;
		const groups: bigint[] = [];
		const pushGroup = (text: string) => {
			if (text.includes('.')) {
				let value = 0n;
				for (const part of text.split('.')) value = (value << 8n) | BigInt(part);
				groups.push(value >> 16n, value & 0xffffn);
			} else {
				groups.push(BigInt(parseInt(text || '0', 16)));
			}
		};
		const head = sections[0] ? sections[0].split(':') : [];
		for (const text of head) pushGroup(text);
		if (sections.length === 2) {
			const tail = sections[1] ? sections[1].split(':') : [];
			const filler = 8 - head.length - tail.length;
			if (filler < 0) return undefined;
			for (let index = 0; index < filler; index++) groups.push(0n);
			for (const text of tail) pushGroup(text);
		}
		if (groups.length !== 8) return undefined;
		let value = 0n;
		for (const group of groups) value = (value << 16n) | (group & 0xffffn);
		return { family: 6, value };
	}
	return undefined;
}

// net.BlockList 在部分 Node 24 小版本上拒绝 IPv6，这里用位运算自行比较网段前缀
function ipMatchesCidr(address: string, network: string, prefixText: string): boolean {
	const prefix = Number(prefixText);
	const target = parseIpAddress(address);
	const base = parseIpAddress(network);
	if (!target || !base || target.family !== base.family) return false;
	const totalBits = target.family === 4 ? 32 : 128;
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > totalBits) return false;
	const hostBits = BigInt(totalBits - prefix);
	return target.value >> hostBits === base.value >> hostBits;
}

/** 与常见 no_proxy 语义一致：*、精确主机、域后缀、host:port；额外支持 IP 网段（如 10.0.0.0/8） */
export function shouldBypassProxyUrl(url: URL): boolean {
	const noProxy = firstEnvValue('NO_PROXY', 'no_proxy');
	if (!noProxy) return false;
	const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
	const port = url.port;
	const address = isIP(hostname) ? hostname : undefined;
	for (const rawEntry of noProxy.split(/[,\s]+/)) {
		const entry = rawEntry.trim().toLowerCase();
		if (!entry) continue;
		if (entry === '*') return true;
		if (entry.includes('/')) {
			const [network, prefix] = entry.split('/');
			if (address && ipMatchesCidr(address, network, prefix)) return true;
			continue;
		}
		const [host, entryPort] = entry.split(':');
		if (entryPort && entryPort !== port) continue;
		if (host.startsWith('*.') && hostname.endsWith(host.slice(1))) return true;
		if (host.startsWith('.') && hostname.endsWith(host)) return true;
		if (hostname === host) return true;
	}
	return false;
}

class HttpRequestError extends Error {
	constructor(public url: string, public code: number, message: string) {
		super(`请求 ${url} 失败(${code}): ${message}`);
	}
}

function buildQuery(params: Record<string, unknown> | undefined): string {
	if (!params) return '';
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		if (Array.isArray(value)) {
			for (const item of value) search.append(key, String(item));
		} else {
			search.append(key, String(value));
		}
	}
	const query = search.toString();
	return query ? `?${query}` : '';
}

export class AxiosHttp {
	timeout = 30;
	headers: Record<string, string> = {};

	private async getResponseData(response: AxiosResponse<unknown, unknown>): Promise<unknown> {
		let data = response.data;
		if (typeof data === 'string' && ((data.startsWith('{') && data.endsWith('}')) || (data.startsWith('[') && data.endsWith(']')))) {
			try {
				data = JSON.parse(data);
			} catch {
				/** 非 JSON 文本保持原样 */
			}
		}
		return data;
	}

	async fetch<T>(method: HttpRequestMethod, url: string, body?: Record<string, unknown> | string, headers?: Record<string, string>, options?: HttpRequestOptions): Promise<T> {
		return new Promise((done, fail) => {
			let handled = false;
			let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => reject(new HttpRequestError(url, -2, 'Request timeout')), options?.timeoutMs ?? this.timeout * 1000);
			const clearTimer = () => {
				if (timer) clearTimeout(timer);
				timer = null;
			};

			const resolve = (ret: unknown) => {
				clearTimer();
				if (!handled) {
					handled = true;
					done(ret as T);
				}
			};
			const reject = (err: unknown) => {
				clearTimer();
				if (!handled) {
					handled = true;
					fail(((err as AxiosError)?.response?.data as unknown) || err);
				}
			};

			const $headers = { ...headers };
			if (typeof body === 'object') {
				$headers['Content-Type'] = 'application/json;charset=UTF-8';
			}
			const config: AxiosRequestConfig = {
				url,
				method,
				headers: $headers,
				data: typeof body === 'object' ? JSON.stringify(body) : body,
			};
			// axios 会按 http_proxy 等环境变量自动走代理但不解析 no_proxy，内网地址需显式直连
			if (shouldBypassProxyUrl(new URL(url))) config.proxy = false;
			if (options?.responseType) config.responseType = options.responseType;

			axios.request(config).then(async response => {
				const data = await this.getResponseData(response);
				if (response.status >= 400) {
					reject(data || new HttpRequestError(url, response.status, response.statusText));
					return;
				}
				resolve(data);
			}).catch(err => {
				reject(err || new HttpRequestError(url, -1, 'Request failed'));
			});
		});
	}

	post<T>(url: string, data?: Record<string, unknown> | string, headers?: Record<string, string>, options?: HttpRequestOptions): Promise<T> {
		return this.fetch('POST', url, data, headers || this.headers, options);
	}

	get<T>(url: string, params?: Record<string, unknown>, headers?: Record<string, string>, options?: HttpRequestOptions): Promise<T> {
		const query = buildQuery(params);
		if (query) {
			url += query;
		}
		return this.fetch('GET', url, undefined, headers || this.headers, options);
	}
}

const http = new AxiosHttp();
export default http;

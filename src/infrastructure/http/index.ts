import type { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import axios from 'axios';

export type HttpRequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

export interface HttpRequestOptions {
	responseType?: 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream';
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
	timeout = 15;
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
			let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => reject(new HttpRequestError(url, -2, 'Request timeout')), this.timeout * 1000);
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

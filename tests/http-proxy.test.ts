import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstEnvValue, shouldBypassProxyUrl } from '../src/infrastructure/http';

const PROXY_ENV_KEYS = ['NO_PROXY', 'no_proxy', 'HTTP_PROXY', 'http_proxy'] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
	for (const key of PROXY_ENV_KEYS) {
		savedEnv.set(key, process.env[key]);
		delete process.env[key];
	}
});

afterEach(() => {
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe('firstEnvValue', () => {
	it('按顺序返回第一个非空环境变量', () => {
		process.env.no_proxy = 'example.com';
		expect(firstEnvValue('NO_PROXY', 'no_proxy')).toBe('example.com');
	});

	it('全部缺失时返回 undefined', () => {
		expect(firstEnvValue('NO_PROXY', 'no_proxy')).toBeUndefined();
	});
});

describe('shouldBypassProxyUrl', () => {
	it('未设置 NO_PROXY 时不 bypass', () => {
		expect(shouldBypassProxyUrl(new URL('http://tts.lan:8080/v1'))).toBe(false);
	});

	it('通配符 * 匹配任意主机', () => {
		process.env.no_proxy = '*';
		expect(shouldBypassProxyUrl(new URL('http://api.example.com/v1'))).toBe(true);
	});

	it('精确主机名匹配（含大小写归一）', () => {
		process.env.no_proxy = 'nas.lan,tts.lan';
		expect(shouldBypassProxyUrl(new URL('http://TTS.LAN:8080/v1'))).toBe(true);
		expect(shouldBypassProxyUrl(new URL('http://build-01.lan/v1'))).toBe(false);
	});

	it('域后缀匹配 *.domain 与 .domain', () => {
		process.env.no_proxy = '*.internal.example,.intranet.example';
		expect(shouldBypassProxyUrl(new URL('http://a.internal.example/v1'))).toBe(true);
		expect(shouldBypassProxyUrl(new URL('http://x.intranet.example/v1'))).toBe(true);
		expect(shouldBypassProxyUrl(new URL('http://evilinternal.example/v1'))).toBe(false);
	});

	it('host:port 条目仅在端口一致时匹配', () => {
		process.env.no_proxy = 'tts.lan:8080';
		expect(shouldBypassProxyUrl(new URL('http://tts.lan:8080/v1'))).toBe(true);
		expect(shouldBypassProxyUrl(new URL('http://tts.lan:9090/v1'))).toBe(false);
	});

	it('无端口的条目匹配任意端口', () => {
		process.env.no_proxy = 'tts.lan';
		expect(shouldBypassProxyUrl(new URL('http://tts.lan:8080/v1'))).toBe(true);
	});

	it('IPv4 网段（CIDR）匹配', () => {
		process.env.no_proxy = '10.0.0.0/8,192.168.1.0/24';
		expect(shouldBypassProxyUrl(new URL('http://10.20.30.40:8080/v1'))).toBe(true);
		expect(shouldBypassProxyUrl(new URL('http://192.168.1.99/v1'))).toBe(true);
		expect(shouldBypassProxyUrl(new URL('http://192.168.2.1/v1'))).toBe(false);
	});

	it('IPv6 网段（CIDR）匹配', () => {
		process.env.no_proxy = '2001:db8:abcd::/48';
		expect(shouldBypassProxyUrl(new URL('http://[2001:db8:abcd::10]:8080/v1'))).toBe(true);
		expect(shouldBypassProxyUrl(new URL('http://[2001:db8:abce::10]/v1'))).toBe(false);
	});

	it('主机名不参与 CIDR 匹配', () => {
		process.env.no_proxy = '10.0.0.0/8';
		expect(shouldBypassProxyUrl(new URL('http://tts.lan:8080/v1'))).toBe(false);
	});
});

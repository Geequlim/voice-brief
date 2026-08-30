import { describe, expect, test } from 'vitest';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import { VoiceBriefDaemonEndpointService } from '../src/runtime/services/daemon-endpoint-service';

describe('VoiceBrief daemon endpoint', () => {
	const service = new VoiceBriefDaemonEndpointService({} as VoiceBriefRuntimeModule);

	test('同一个 profile 生成稳定 endpoint，不同 profile 相互隔离', () => {
		const first = service.resolveForStateDir('/home/user/.local/state/voice-brief', 'linux', '/tmp');
		const second = service.resolveForStateDir('/home/user/.local/state/voice-brief', 'linux', '/tmp');
		const isolated = service.resolveForStateDir('/tmp/another-profile', 'linux', '/tmp');

		expect(first).toEqual(second);
		expect(isolated.address).not.toBe(first.address);
		expect(first.address).toMatch(/^\/tmp\/voice-brief-[a-f0-9]{24}\/daemon\.sock$/);
	});

	test('Windows 使用命名管道且 profile 大小写不敏感', () => {
		const first = service.resolveForStateDir('C:\\Users\\Alice\\VoiceBrief', 'win32');
		const second = service.resolveForStateDir('c:\\users\\alice\\voicebrief', 'win32');

		expect(first.address).toBe(second.address);
		expect(first.address).toMatch(/^\\\\\.\\pipe\\voice-brief-[a-f0-9]{24}$/);
		expect(first.socketFile).toBeUndefined();
	});

	test('Unix endpoint 过长时回退到短路径', () => {
		const endpoint = service.resolveForStateDir('/profile', 'darwin', `/tmp/${'long-'.repeat(30)}`);

		expect(endpoint.address.startsWith('/tmp/voice-brief-')).toBe(true);
		expect(Buffer.byteLength(endpoint.address)).toBeLessThanOrEqual(90);
	});
});

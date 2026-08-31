import { describe, expect, test } from 'vitest';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import { VoiceBriefDaemonEndpointService } from '../src/runtime/services/daemon-endpoint-service';

describe('VoiceBrief daemon endpoint', () => {
	const service = new VoiceBriefDaemonEndpointService({} as VoiceBriefRuntimeModule);

	test('同一用户在不同 XDG_STATE_HOME 环境下共享同一 endpoint', () => {
		const first = service.resolveForIdentity('1000', 'linux', '/tmp', { XDG_RUNTIME_DIR: '/run/user/1000' });
		const second = service.resolveForIdentity('1000', 'linux', '/tmp', {
			XDG_RUNTIME_DIR: '/run/user/1000',
			XDG_STATE_HOME: '/home/user/.config/opencode-desktop',
		});

		expect(first).toEqual(second);
		expect(first.address).toMatch(/^\/run\/user\/1000\/voice-brief-[a-f0-9]{24}\/daemon\.sock$/);
	});

	test('无 XDG_RUNTIME_DIR 时回退到 tempDir 并保持身份隔离', () => {
		const first = service.resolveForIdentity('1000', 'linux', '/tmp', {});
		const second = service.resolveForIdentity('1000', 'linux', '/tmp', {});
		const isolated = service.resolveForIdentity('1001', 'linux', '/tmp', {});

		expect(first).toEqual(second);
		expect(isolated.address).not.toBe(first.address);
		expect(first.address).toMatch(/^\/tmp\/voice-brief-[a-f0-9]{24}\/daemon\.sock$/);
	});

	test('XDG_RUNTIME_DIR 必须是绝对路径才生效', () => {
		const relative = service.resolveForIdentity('1000', 'linux', '/tmp', { XDG_RUNTIME_DIR: 'runtime-dir' });

		expect(relative.address).toMatch(/^\/tmp\/voice-brief-[a-f0-9]{24}\/daemon\.sock$/);
	});

	test('Windows 使用命名管道且身份大小写不敏感', () => {
		const first = service.resolveForIdentity('Alice', 'win32', '/tmp', { USERNAME: 'Alice' });
		const second = service.resolveForIdentity('alice', 'win32', '/tmp', { USERNAME: 'alice' });

		expect(first.address).toBe(second.address);
		expect(first.address).toMatch(/^\\\\\.\\pipe\\voice-brief-[a-f0-9]{24}$/);
		expect(first.socketFile).toBeUndefined();
	});

	test('Unix endpoint 过长时回退到短路径', () => {
		const endpoint = service.resolveForIdentity('1000', 'darwin', `/var/folders/${'long-'.repeat(30)}`, {});

		expect(endpoint.address.startsWith('/tmp/voice-brief-')).toBe(true);
		expect(Buffer.byteLength(endpoint.address)).toBeLessThanOrEqual(90);
	});
});

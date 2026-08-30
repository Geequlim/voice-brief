import { describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/index';

describe('CLI 行为与退出码', () => {
	test('--version 输出版本号并返回 0', async () => {
		const chunks: string[] = [];
		const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
			chunks.push(String(chunk));
			return true;
		});
		try {
			const exitCode = await createApp().runCli(['--version']);
			expect(exitCode).toBe(0);
		} finally {
			spy.mockRestore();
		}
		expect(chunks.join('')).toBe(`${VERSION.name}\n`);
	});

	test('未知命令输出错误与根帮助并返回 1', async () => {
		const errChunks: string[] = [];
		const outChunks: string[] = [];
		const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
			errChunks.push(String(chunk));
			return true;
		});
		const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
			outChunks.push(String(chunk));
			return true;
		});
		try {
			const exitCode = await createApp().runCli(['nosuchcmd']);
			expect(exitCode).toBe(1);
		} finally {
			errSpy.mockRestore();
			outSpy.mockRestore();
		}
		const stderr = errChunks.join('');
		expect(stderr).toContain("error: unknown command 'nosuchcmd'");
		expect(stderr).toContain('Usage: voice-brief [options] [command]');
	});

	test('无参数时在 stderr 输出根帮助并返回 1', async () => {
		const errChunks: string[] = [];
		const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
			errChunks.push(String(chunk));
			return true;
		});
		try {
			const exitCode = await createApp().runCli([]);
			expect(exitCode).toBe(1);
		} finally {
			errSpy.mockRestore();
		}
		const stderr = errChunks.join('');
		expect(stderr).toContain('Usage: voice-brief [options] [command]');
		expect(stderr).toContain('Commands:');
	});

	test('必填参数缺失时返回 1 并提示', async () => {
		const errChunks: string[] = [];
		const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
			errChunks.push(String(chunk));
			return true;
		});
		try {
			const exitCode = await createApp().runCli(['install']);
			expect(exitCode).toBe(1);
		} finally {
			errSpy.mockRestore();
		}
		expect(errChunks.join('')).toContain("error: missing required argument 'persona'");
	});
});

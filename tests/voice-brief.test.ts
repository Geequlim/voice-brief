import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const voiceBriefModules = vi.hoisted(() => ({
	VoiceBriefConfigModule: class VoiceBriefConfigModule {},
	VoiceBriefPersonaModule: class VoiceBriefPersonaModule {},
}));

vi.mock('../src/config', () => ({
	VoiceBriefConfigModule: voiceBriefModules.VoiceBriefConfigModule,
}));

vi.mock('../src/persona', () => ({
	VoiceBriefPersonaModule: voiceBriefModules.VoiceBriefPersonaModule,
}));

import { VoiceBriefInitCommand, VoiceBriefStatusCommand } from '../src/config/command';
import { VoiceBriefConfigService } from '../src/config/services/config-service';
import type { VoiceBriefConfig, VoiceBriefState } from '../src/config/schema';
import type { VoiceBriefInstallModule } from '../src/install';
import { VoiceBriefMarkerBlockService } from '../src/install/services/marker-block-service';
import type { VoiceBriefPersonaModule } from '../src/persona';
import type { VoicePersona } from '../src/persona/types';
import type { VoiceBriefRuntimeModule } from '../src/runtime';
import { VoiceBriefRuntimeConfigCommand, VoiceBriefSpeakCommand } from '../src/runtime/command';
import { VoiceBriefRuntimeService } from '../src/runtime/services/runtime-service';
import { VoiceBriefThrottleService } from '../src/runtime/services/throttle-service';

const mockBundledPersonaTemplates = async () => {
	const defaultPersonaText = await fs.readFile(path.join(process.cwd(), 'src/persona/templates/默认中文助理.md'), 'utf-8');
	const intellectualPersonaText = await fs.readFile(path.join(process.cwd(), 'src/persona/templates/知性姐姐.md'), 'utf-8');
	const sweetPersonaText = await fs.readFile(path.join(process.cwd(), 'src/persona/templates/甜妹助理.md'), 'utf-8');
	const energeticPersonaText = await fs.readFile(path.join(process.cwd(), 'src/persona/templates/元气搭子.md'), 'utf-8');
	vi.doMock('../src/persona/templates/默认中文助理.md', () => ({ default: defaultPersonaText }));
	vi.doMock('../src/persona/templates/知性姐姐.md', () => ({ default: intellectualPersonaText }));
	vi.doMock('../src/persona/templates/甜妹助理.md', () => ({ default: sweetPersonaText }));
	vi.doMock('../src/persona/templates/元气搭子.md', () => ({ default: energeticPersonaText }));
	return {
		defaultPersonaText,
		intellectualPersonaText,
		sweetPersonaText,
		energeticPersonaText,
	};
};

const createTestConfig = (): VoiceBriefConfig => ({
	version: 1,
	enabled: true,
	provider: 'edge',
	fallbackProvider: undefined,
	alignment: { enabled: false, provider: 'audiocpp' },
	hooks: [],
	providers: {},
	playback: {
		command: 'auto',
		startDelayMs: 0,
		ducking: {
			enabled: true,
			attenuationDb: 18,
			restoreFadeMs: 700,
		},
	},
	cache: {
		enabled: true,
		ttlMs: 60000,
		maxEntries: 100,
		pruneIntervalMs: 30000,
	},
	throttle: {
		progressIntervalMs: 30000,
		highPriorityIntervalMs: 5000,
		networkCheckTtlMs: 60000,
	},
});

describe('voice-brief marker block', () => {
	test('重复写入同一个 marker 时保持幂等', () => {
		const service = new VoiceBriefMarkerBlockService({} as VoiceBriefInstallModule);
		const first = service.upsert('', 'codex', 'hello');
		const second = service.upsert(first, 'codex', 'hello');

		expect(second).toBe(first);
		expect(second.match(/voice-brief:codex:start/g)).toHaveLength(1);
	});

	test('进度提示超限且没有句子边界时整段保留', () => {
		const service = new VoiceBriefThrottleService({} as VoiceBriefRuntimeModule);
		expect(service.normalizeText('测'.repeat(100), 'progress')).toEqual({
			text: '测'.repeat(100),
			kind: 'progress',
			limitChars: 80,
			originalChars: 100,
			adjusted: true,
			boundary: false,
		});
	});

	test('超限文本会向后补齐到句子边界收尾', () => {
		const service = new VoiceBriefThrottleService({} as VoiceBriefRuntimeModule);
		const text = `${'好'.repeat(159)}。后面还有一句。`;
		const normalized = service.normalizeText(text, 'final');

		expect(normalized).toEqual({
			text: `${'好'.repeat(159)}。`,
			kind: 'final',
			limitChars: 160,
			originalChars: 167,
			adjusted: true,
			boundary: true,
		});
	});

	test('未超限文本原样保留', () => {
		const service = new VoiceBriefThrottleService({} as VoiceBriefRuntimeModule);
		const normalized = service.normalizeText('任务已经完成，可以继续下一步。  ', 'final');

		expect(normalized).toMatchObject({ adjusted: false, boundary: true, originalChars: 15 });
	});

	test('实际超限样例会在最后一个句号处收尾而不是切断词句', () => {
		const service = new VoiceBriefThrottleService({} as VoiceBriefRuntimeModule);
		const text = '盘点完成：主要还可升级的是 ESLint、Prettier、Stylelint、PostCSS、Svelte ESLint 插件和几个辅助工具；Rspack、Vite、Storybook、Vitest、Playwright、Svelte 已基本是最新。typescript-eslint 受 TS7 兼容限制，zip 工具和内部预览工具需要单独评估。';
		const normalized = service.normalizeText(text, 'final');

		expect(normalized.text.endsWith('需要单独评估。')).toBe(true);
		expect(service.formatAdjustmentWarning(normalized)).toBe(
			'最终简报文本共 175 字，超出 160 字上限，已在句子边界收尾播报（本次 175 字）。下次请把最终简报控制在 160 字以内。',
		);
	});

	test('无句子边界的超限文本会生成完整播报警告', () => {
		const service = new VoiceBriefThrottleService({} as VoiceBriefRuntimeModule);
		const normalized = service.normalizeText('测'.repeat(100), 'progress');

		expect(service.formatAdjustmentWarning(normalized)).toBe(
			'过程播报文本共 100 字，超出 80 字上限，未找到句子边界，已完整播报（本次 100 字）。下次请把过程播报控制在 80 字以内。',
		);
	});

	test('相同进度提示在节流窗口内会被跳过', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-05-09T10:00:00Z'));
			const service = new VoiceBriefThrottleService({} as VoiceBriefRuntimeModule);
			const config = createTestConfig();
			const state: VoiceBriefState = {};
			const brief = '这边正在测试过程播报喔，接下来会继续检查配置。';

			service.applyProgressState(state, brief);
			const result = service.getProgressSkipResult(state, config, brief, 'normal');

			expect(result).toEqual({
				status: 'skipped',
				message: '重复进度提示已跳过',
				reason: 'duplicate',
			});
		} finally {
			vi.useRealTimers();
		}
	});

	test('相同进度提示超过节流窗口后允许再次播报', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-05-09T10:00:00Z'));
			const service = new VoiceBriefThrottleService({} as VoiceBriefRuntimeModule);
			const config = createTestConfig();
			const state: VoiceBriefState = {};
			const brief = '这边正在测试过程播报喔，接下来会继续检查配置。';

			service.applyProgressState(state, brief);
			vi.setSystemTime(new Date('2026-05-09T10:00:31Z'));
			const result = service.getProgressSkipResult(state, config, brief, 'normal');

			expect(result).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	test('speak 取得 daemon 准入结果后返回，不等待语音生成', async () => {
		const lines: string[] = [];
		const submit = vi.fn().mockResolvedValue({ status: 'synthesizing', requestId: 'request-1', provider: 'mock' });
		const command = new VoiceBriefSpeakCommand({
			daemonClientService: { submit },
		} as never);

		const code = await command.speak({
			args: { text: ['测试'] },
			options: { persona: '不存在的人设' },
		} as never, {
			line: (message: string) => {
				lines.push(message);
			},
		} as never);

		expect(code).toBe(0);
		expect(lines).toEqual(['[voice-brief] synthesis started via mock']);
		expect(submit).toHaveBeenCalledWith(expect.objectContaining({
			options: expect.objectContaining({ personaName: '不存在的人设' }),
		}));
	});

	test('runtime configure 通过 daemon 设置播放启动延迟', async () => {
		const lines: string[] = [];
		const configureRuntime = vi.fn().mockResolvedValue({ playbackStartDelayMs: 1150 });
		const command = new VoiceBriefRuntimeConfigCommand({
			daemonClientService: { configureRuntime },
		} as never);

		const code = await command.configure({
			options: { playbackStartDelayMs: 1150 },
		} as never, {
			line: (message: string) => lines.push(message),
		} as never);

		expect(code).toBe(0);
		expect(configureRuntime).toHaveBeenCalledWith({ playbackStartDelayMs: 1150 });
		expect(lines).toEqual(['[voice-brief] playback start delay set to 1150ms']);
	});

	test('status 文本输出会包含人设目录', async () => {
		const lines: string[] = [];
		const command = new VoiceBriefStatusCommand({
			pathService: {
				resolveVoiceBriefPaths: async () => ({
					configDir: '/tmp/config',
					configFile: '/tmp/config/config.yaml',
					personaDir: '/tmp/config/personas',
					stateDir: '/tmp/state',
					stateFile: '/tmp/state/state.yaml',
					cacheDir: '/tmp/cache',
					tempDir: '/tmp/temp',
				}),
			},
			configService: {
				ensure: async () => createTestConfig(),
			},
			stateService: {
				load: async () => ({}),
			},
		} as never);

		const code = await command.status({
			options: {},
		} as never, {
			line: (message: string) => {
				lines.push(message);
			},
		} as never);

		expect(code).toBe(0);
		expect(lines).toContain('Personas: /tmp/config/personas');
	});

	test('speak 缓存命中时输出 provider', async () => {
		const lines: string[] = [];
		const command = new VoiceBriefSpeakCommand({
			daemonClientService: {
				submit: async () => ({ status: 'cached', requestId: 'request-1', provider: 'edge' }),
			},
		} as never);

		const code = await command.speak({
			args: { text: ['测试'] },
			options: {},
		} as never, {
			line: (message: string) => {
				lines.push(message);
			},
		} as never);

		expect(code).toBe(0);
		expect(lines).toEqual(['[voice-brief] cache hit via edge']);
	});

	test('speak 被跳过时输出原因并保持成功退出', async () => {
		const lines: string[] = [];
		const command = new VoiceBriefSpeakCommand({
			daemonClientService: {
				submit: async () => ({ status: 'skipped', requestId: 'request-1', reason: 'throttled' }),
			},
		} as never);
		const code = await command.speak({ args: { text: ['测试'] }, options: {} } as never, {
			line: (message: string) => { lines.push(message); },
		} as never);

		expect(code).toBe(0);
		expect(lines).toEqual(['[voice-brief] request skipped: throttled']);
	});

	test('speak 容量拒绝时输出可读原因并返回失败', async () => {
		const lines: string[] = [];
		const command = new VoiceBriefSpeakCommand({
			daemonClientService: {
				submit: async () => ({ status: 'rejected', requestId: 'request-1', reason: 'capacity', provider: 'edge' }),
			},
		} as never);

		const code = await command.speak({ args: { text: ['测试'] }, options: {} } as never, {
			line: (message: string) => { lines.push(message); },
		} as never);

		expect(code).toBe(1);
		expect(lines).toEqual(['[voice-brief] request rejected: capacity']);
	});

	test('speak 超限时在 stderr 输出警告并保持成功退出', async () => {
		const lines: string[] = [];
		const errors: string[] = [];
		const warning = '最终简报文本共 175 字，超出 160 字上限，已在句子边界收尾播报（本次 175 字）。下次请把最终简报控制在 160 字以内。';
		const command = new VoiceBriefSpeakCommand({
			daemonClientService: {
				submit: async () => ({ status: 'synthesizing', requestId: 'request-1', provider: 'edge', warning }),
			},
		} as never);

		const code = await command.speak({
			args: { text: ['测试'] },
			options: {},
			stderr: { write: (chunk: string) => { errors.push(chunk); } },
		} as never, {
			line: (message: string) => { lines.push(message); },
		} as never);

		expect(code).toBe(0);
		expect(lines).toEqual(['[voice-brief] synthesis started via edge']);
		expect(errors).toEqual([`[voice-brief] warning: ${warning}\n`]);
	});

	test('speak 会将来源上下文提交给 daemon', async () => {
		const submit = vi.fn().mockResolvedValue({ status: 'synthesizing', requestId: 'request-1', provider: 'mock' });
		const command = new VoiceBriefSpeakCommand({
			daemonClientService: { submit },
		} as never);

		const code = await command.speak({
			args: { text: ['测试'] },
			options: {
				agent: 'codex',
				model: 'gpt-5.6-sol',
				persona: '甜妹助理',
				session: '语音简报协议',
			},
		} as never, {
			line: (): void => undefined,
		} as never);

		expect(code).toBe(0);
		expect(submit).toHaveBeenCalledWith({
			kind: 'final',
			text: '测试',
			options: {
				agent: 'codex',
				model: 'gpt-5.6-sol',
				personaName: '甜妹助理',
				priority: 'normal',
				session: '语音简报协议',
			},
		});
	});

	test('人设会解析角色展示字段', async () => {
		const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-persona-display-'));
		const personaDir = path.join(rootDir, 'personas');
		await fs.mkdir(personaDir, { recursive: true });
		await fs.writeFile(path.join(personaDir, '展示角色.md'), '---\navatar: assets/avatar.png\ncolor: "#F59EAE"\n---\n\n# 展示角色\n', 'utf-8');
		await mockBundledPersonaTemplates();
		const { VoiceBriefPersonaService } = await import('../src/persona/services/persona-service.js');
		const service = new VoiceBriefPersonaService({
			app: {
				getModule(moduleType: unknown) {
					if (moduleType === voiceBriefModules.VoiceBriefConfigModule) {
						return {
							pathService: {
								resolveVoiceBriefPaths: async () => ({ personaDir }),
							},
						};
					}
					throw new Error('未知测试模块');
				},
			},
		} as VoiceBriefPersonaModule);

		await expect(service.load('展示角色')).resolves.toMatchObject({
			avatar: 'assets/avatar.png',
			color: '#F59EAE',
			name: '展示角色',
		});
	});

	test('init 默认不覆盖已有配置，传 force 时会覆盖配置和内置人设', async () => {
		const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-init-'));
		const configFile = path.join(rootDir, 'config.yaml');
		const personaDir = path.join(rootDir, 'personas');
		await fs.mkdir(personaDir, { recursive: true });
		await fs.writeFile(configFile, 'version: 1\nenabled: false\nprovider: edge\n', 'utf-8');
		await fs.writeFile(path.join(personaDir, '知性姐姐.md'), '# 自定义知性姐姐\n', 'utf-8');

		const configModule = {
			configService: {
				examplePersonaFile: '默认中文助理.md',
			},
			pathService: {
				ensureVoiceBriefDirs: async () => {
					await fs.mkdir(personaDir, { recursive: true });
				},
				resolveVoiceBriefPaths: async () => ({
					configDir: rootDir,
					configFile,
					personaDir,
					stateDir: path.join(rootDir, 'state'),
					stateFile: path.join(rootDir, 'state', 'state.yaml'),
					cacheDir: path.join(rootDir, 'cache'),
					tempDir: path.join(rootDir, 'tmp'),
				}),
			},
		};
		const configService = new VoiceBriefConfigService({
			pathService: configModule.pathService,
		} as never);
		await mockBundledPersonaTemplates();
		const { VoiceBriefPersonaService } = await import('../src/persona/services/persona-service.js');
		const personaService = new VoiceBriefPersonaService({
			app: {
				getModule(moduleType: unknown) {
					if (moduleType === voiceBriefModules.VoiceBriefConfigModule) return configModule;
					throw new Error('未知测试模块');
				},
			},
		} as VoiceBriefPersonaModule);
		const lines: string[] = [];
		const command = new VoiceBriefInitCommand({
			app: {
				getModule(name: string) {
					if (name === 'VoiceBriefPersonaModule') {
						return {
							personaService,
						};
					}
					return undefined;
				},
			},
			configService,
		} as never);

		await command.init({
			options: {},
		} as never, {
			line: (message: string) => {
				lines.push(message);
			},
		} as never);

		expect(lines).toEqual([`Config: ${configFile}`]);
		expect(await fs.readFile(configFile, 'utf-8')).toContain('enabled: false');
		expect((await configService.load()).playback.ducking).toEqual({ enabled: true, attenuationDb: 24, restoreFadeMs: 700 });
		expect(await fs.readFile(path.join(personaDir, '知性姐姐.md'), 'utf-8')).toBe('# 自定义知性姐姐\n');
		await fs.writeFile(configFile, 'version: 1\nenabled: false\nprovider: edge\nplayback:\n  ducking:\n    restoreFadeMs: 0\n', 'utf-8');
		expect((await configService.load()).playback.ducking.restoreFadeMs).toBe(0);

		await command.init({
			options: {
				force: true,
			},
		} as never, {
			line: (_message: string): void => undefined,
		} as never);

		expect(await fs.readFile(configFile, 'utf-8')).toContain('enabled: true');
		expect(await fs.readFile(path.join(personaDir, '知性姐姐.md'), 'utf-8')).toContain('# 知性姐姐');
	});

	test('安装时按人设和 verbose 开关生成中文全局提示词', async () => {
		const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-install-'));
		const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-agents-'));
		const voiceBriefTemplate = await fs.readFile(path.join(process.cwd(), 'src/install/templates/voice-brief.md'), 'utf-8');
		vi.doMock('../src/install/templates/SKILL.md', () => ({ default: 'voice-brief skill' }));
		vi.doMock('../src/install/templates/voice-brief.md', () => ({ default: voiceBriefTemplate }));
		const { VoiceBriefInstallService } = await import('../src/install/services/install-service.js');
		const persona = {
			fileName: '小美.md',
			name: '小美',
			instructions: '你是小美。',
		} as VoicePersona;
		const configModule = {
			pathService: {
				resolveAgentsHome: () => agentsHome,
				resolveCodexHome: () => codexHome,
			},
		};
		const personaModule = {
			personaService: {
				ensureBundledPersonas: async () => {},
				load: async () => persona,
			},
		};
		const installModule = {
			app: {
				getModule(moduleType: unknown) {
					if (moduleType === voiceBriefModules.VoiceBriefConfigModule) return configModule;
					if (moduleType === voiceBriefModules.VoiceBriefPersonaModule) return personaModule;
					throw new Error('未知测试模块');
				},
			},
		} as VoiceBriefInstallModule;
		(installModule as { markerBlockService: VoiceBriefMarkerBlockService }).markerBlockService = new VoiceBriefMarkerBlockService(installModule);
		const service = new VoiceBriefInstallService(installModule);

		const plan = await service.install('小美', 'codex');
		const prompt = await fs.readFile(path.join(codexHome, 'AGENTS.md'), 'utf-8');
		const skill = await fs.readFile(path.join(agentsHome, 'skills', 'voice-brief', 'SKILL.md'), 'utf-8');

		expect(plan.verbose).toBe(true);
		expect(prompt).toContain('语音简报协议');
		expect(prompt).toContain('Voice Brief 是本机语音简报工具');
		expect(prompt).toContain('实时语音会话');
		expect(prompt).toContain('B. 准备工作播报');
		expect(prompt).toContain('C. 准备行动播报');
		expect(prompt).toContain('D. 行动进展汇报');
		expect(prompt).toContain('E. 长等待说明');
		expect(prompt).toContain('`request rejected` 或命令执行失败表示本次没有创建语音任务');
		expect(prompt).toContain('不要等待合成或播放完成');
		expect(prompt).toContain('当前 Voice Brief 人设只用于撰写');
		expect(prompt).toContain('不得影响以下内容');
		expect(prompt).toContain('你是小美。');
		expect(prompt).toContain('-p "小美"');
		expect(prompt).toContain('-a "codex"');
		expect(prompt).toContain('标题一旦通过 `-s` 传过');
		expect(prompt).not.toContain('{{agent}}');
		expect(prompt).not.toContain('--progress');
		expect(prompt).toContain('voice-brief speak');
		expect(prompt).toContain('-P');
		expect(prompt).not.toContain('voice-brief:progress');
		expect(skill).toBe('voice-brief skill');

		await service.install('小美', 'codex', { verbose: false });
		const disabledPrompt = await fs.readFile(path.join(codexHome, 'AGENTS.md'), 'utf-8');

		expect(disabledPrompt).toContain('不要播放过程播报');
		expect(disabledPrompt).not.toContain('B. 准备工作播报');
		expect(disabledPrompt).not.toContain('C. 准备行动播报');
		expect(disabledPrompt).not.toContain('D. 行动进展汇报');
		expect(disabledPrompt).not.toContain('E. 长等待说明');
		expect(disabledPrompt).not.toContain('voice-brief speak -P <80字以内的中文过程播报文本参数>');
		expect(disabledPrompt).not.toContain('voice-brief:progress');
	});

	test('Claude 安装时会写入 skill 并追加 voice-brief 命令权限', async () => {
		const claudeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-claude-'));
		const voiceBriefTemplate = await fs.readFile(path.join(process.cwd(), 'src/install/templates/voice-brief.md'), 'utf-8');
		vi.doMock('../src/install/templates/SKILL.md', () => ({ default: 'voice-brief skill' }));
		vi.doMock('../src/install/templates/voice-brief.md', () => ({ default: voiceBriefTemplate }));
		const { VoiceBriefInstallService } = await import('../src/install/services/install-service.js');
		const persona = {
			fileName: '小美.md',
			name: '小美',
			instructions: '你是小美。',
		} as VoicePersona;
		const configModule = {
			pathService: {
				resolveClaudeHome: () => claudeHome,
			},
		};
		const personaModule = {
			personaService: {
				ensureBundledPersonas: async () => {},
				load: async () => persona,
			},
		};
		const installModule = {
			app: {
				getModule(moduleType: unknown) {
					if (moduleType === voiceBriefModules.VoiceBriefConfigModule) return configModule;
					if (moduleType === voiceBriefModules.VoiceBriefPersonaModule) return personaModule;
					throw new Error('未知测试模块');
				},
			},
		} as VoiceBriefInstallModule;
		(installModule as { markerBlockService: VoiceBriefMarkerBlockService }).markerBlockService = new VoiceBriefMarkerBlockService(installModule);
		const service = new VoiceBriefInstallService(installModule);

		const plan = await service.install('小美', 'claude');
		const prompt = await fs.readFile(path.join(claudeHome, 'CLAUDE.md'), 'utf-8');
		const skill = await fs.readFile(path.join(claudeHome, 'skills', 'voice-brief', 'SKILL.md'), 'utf-8');
		const settings = JSON.parse(await fs.readFile(path.join(claudeHome, 'settings.json'), 'utf-8')) as {
			permissions?: {
				allow?: string[];
			};
		};

		expect(plan.files).toContain(path.join(claudeHome, 'settings.json'));
		expect(prompt).toContain('语音简报协议');
		expect(skill).toBe('voice-brief skill');
		expect(settings.permissions?.allow).toContain('Bash(voice-brief:*)');
	});

	test('GitHub Copilot 安装时会写入 copilot 指令文件并复用共享 skill', async () => {
		const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-copilot-'));
		const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-agents-'));
		const voiceBriefTemplate = await fs.readFile(path.join(process.cwd(), 'src/install/templates/voice-brief.md'), 'utf-8');
		vi.doMock('../src/install/templates/SKILL.md', () => ({ default: 'voice-brief skill' }));
		vi.doMock('../src/install/templates/voice-brief.md', () => ({ default: voiceBriefTemplate }));
		const { VoiceBriefInstallService } = await import('../src/install/services/install-service.js');
		const persona = {
			fileName: '小美.md',
			name: '小美',
			instructions: '你是小美。',
		} as VoicePersona;
		const configModule = {
			pathService: {
				resolveAgentsHome: () => agentsHome,
				resolveCopilotHome: () => copilotHome,
			},
		};
		const personaModule = {
			personaService: {
				ensureBundledPersonas: async () => {},
				load: async () => persona,
			},
		};
		const installModule = {
			app: {
				getModule(moduleType: unknown) {
					if (moduleType === voiceBriefModules.VoiceBriefConfigModule) return configModule;
					if (moduleType === voiceBriefModules.VoiceBriefPersonaModule) return personaModule;
					throw new Error('未知测试模块');
				},
			},
		} as VoiceBriefInstallModule;
		(installModule as { markerBlockService: VoiceBriefMarkerBlockService }).markerBlockService = new VoiceBriefMarkerBlockService(installModule);
		const service = new VoiceBriefInstallService(installModule);

		const plan = await service.install('小美', 'copilot');
		const prompt = await fs.readFile(path.join(copilotHome, 'copilot-instructions.md'), 'utf-8');
		const skill = await fs.readFile(path.join(agentsHome, 'skills', 'voice-brief', 'SKILL.md'), 'utf-8');

		expect(plan.target).toBe('copilot');
		expect(prompt).toContain('语音简报协议');
		expect(prompt).toContain('你是小美。');
		expect(prompt).toContain('-p "小美"');
		expect(skill).toBe('voice-brief skill');
	});

	test('Kimi Code 安装时会创建全局提示词文件并复用共享 skill', async () => {
		const kimiCodeHome = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-kimi-code-')), '.kimi-code');
		const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-agents-'));
		const voiceBriefTemplate = await fs.readFile(path.join(process.cwd(), 'src/install/templates/voice-brief.md'), 'utf-8');
		vi.doMock('../src/install/templates/SKILL.md', () => ({ default: 'voice-brief skill' }));
		vi.doMock('../src/install/templates/voice-brief.md', () => ({ default: voiceBriefTemplate }));
		const { VoiceBriefInstallService } = await import('../src/install/services/install-service.js');
		const persona = {
			fileName: '小美.md',
			name: '小美',
			instructions: '你是小美。',
		} as VoicePersona;
		const configModule = {
			pathService: {
				resolveAgentsHome: () => agentsHome,
				resolveKimiCodeHome: () => kimiCodeHome,
			},
		};
		const personaModule = {
			personaService: {
				ensureBundledPersonas: async () => {},
				load: async () => persona,
			},
		};
		const installModule = {
			app: {
				getModule(moduleType: unknown) {
					if (moduleType === voiceBriefModules.VoiceBriefConfigModule) return configModule;
					if (moduleType === voiceBriefModules.VoiceBriefPersonaModule) return personaModule;
					throw new Error('未知测试模块');
				},
			},
		} as VoiceBriefInstallModule;
		(installModule as { markerBlockService: VoiceBriefMarkerBlockService }).markerBlockService = new VoiceBriefMarkerBlockService(installModule);
		const service = new VoiceBriefInstallService(installModule);

		const plan = await service.install('小美', 'kimi-code');
		const prompt = await fs.readFile(path.join(kimiCodeHome, 'AGENTS.md'), 'utf-8');
		const skill = await fs.readFile(path.join(agentsHome, 'skills', 'voice-brief', 'SKILL.md'), 'utf-8');

		expect(plan.target).toBe('kimi-code');
		expect(prompt).toContain('语音简报协议');
		expect(prompt).toContain('你是小美。');
		expect(prompt).toContain('-p "小美"');
		expect(skill).toBe('voice-brief skill');
	});

	test('ZCode 安装时会写入 ~/.zcode/AGENTS.md 并复用共享 skill', async () => {
		const zcodeHome = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-zcode-')), '.zcode');
		const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-agents-'));
		const voiceBriefTemplate = await fs.readFile(path.join(process.cwd(), 'src/install/templates/voice-brief.md'), 'utf-8');
		vi.doMock('../src/install/templates/SKILL.md', () => ({ default: 'voice-brief skill' }));
		vi.doMock('../src/install/templates/voice-brief.md', () => ({ default: voiceBriefTemplate }));
		const { VoiceBriefInstallService } = await import('../src/install/services/install-service.js');
		const persona = {
			fileName: '小美.md',
			name: '小美',
			instructions: '你是小美。',
		} as VoicePersona;
		const configModule = {
			pathService: {
				resolveAgentsHome: () => agentsHome,
				resolveZcodeHome: () => zcodeHome,
			},
		};
		const personaModule = {
			personaService: {
				ensureBundledPersonas: async () => {},
				load: async () => persona,
			},
		};
		const installModule = {
			app: {
				getModule(moduleType: unknown) {
					if (moduleType === voiceBriefModules.VoiceBriefConfigModule) return configModule;
					if (moduleType === voiceBriefModules.VoiceBriefPersonaModule) return personaModule;
					throw new Error('未知测试模块');
				},
			},
		} as VoiceBriefInstallModule;
		(installModule as { markerBlockService: VoiceBriefMarkerBlockService }).markerBlockService = new VoiceBriefMarkerBlockService(installModule);
		const service = new VoiceBriefInstallService(installModule);

		const plan = await service.install('小美', 'zcode');
		const prompt = await fs.readFile(path.join(zcodeHome, 'AGENTS.md'), 'utf-8');
		const skill = await fs.readFile(path.join(agentsHome, 'skills', 'voice-brief', 'SKILL.md'), 'utf-8');

		expect(plan.target).toBe('zcode');
		expect(prompt).toContain('语音简报协议');
		expect(prompt).toContain('你是小美。');
		expect(prompt).toContain('-p "小美"');
		expect(skill).toBe('voice-brief skill');
	});

	test('初始化会复制内置人设模板到配置目录', async () => {
		const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-brief-persona-'));
		const { intellectualPersonaText, sweetPersonaText } = await mockBundledPersonaTemplates();
		const { VoiceBriefPersonaService } = await import('../src/persona/services/persona-service.js');
		const configModule = {
			configService: {
				examplePersonaFile: '默认中文助理.md',
			},
			pathService: {
				ensureVoiceBriefDirs: async () => {
					await fs.mkdir(path.join(configDir, 'personas'), { recursive: true });
				},
				resolveVoiceBriefPaths: async () => ({
					personaDir: path.join(configDir, 'personas'),
				}),
			},
		};
		const personaModule = {
			app: {
				getModule(moduleType: unknown) {
					if (moduleType === voiceBriefModules.VoiceBriefConfigModule) return configModule;
					throw new Error('未知测试模块');
				},
			},
		} as VoiceBriefPersonaModule;
		const service = new VoiceBriefPersonaService(personaModule);

		await service.ensureBundledPersonas();
		const personas = await service.list();
		const intellectualPersonaMarkdown = await service.readMarkdown('知性姐姐');
		const intellectualPersona = await service.load('知性姐姐');
		const sweetPersonaMarkdown = await service.readMarkdown('甜妹助理');
		const sweetPersona = await service.load('甜妹助理');
		const energeticPersona = await service.load('元气搭子');

		expect(personas).toContain('默认中文助理');
		expect(personas).toContain('知性姐姐');
		expect(personas).toContain('甜妹助理');
		expect(personas).toContain('元气搭子');
		expect(personas).not.toContain('默认中文助理.md');
		expect(personas).not.toContain('知性姐姐.md');
		expect(personas).not.toContain('甜妹助理.md');
		expect(personas).not.toContain('元气搭子.md');
		expect(intellectualPersona.name).toBe('知性姐姐');
		expect(intellectualPersona.fish?.referenceId).toBe('a1417155aa234890aab4a18686d12849');
		expect(intellectualPersona.edge?.voice).toBe('zh-CN-XiaoyiNeural');
		expect(intellectualPersona.instructions).toContain('像一位思路稳定');
		expect(intellectualPersonaMarkdown).toBe(intellectualPersonaText);
		expect(sweetPersona.name).toBe('甜妹助理');
		expect(sweetPersona.fish?.referenceId).toBe('5671e9d40d7a48e1b81e78ff58359903');
		expect(sweetPersona.edge?.voice).toBe('zh-TW-HsiaoChenNeural');
		expect(sweetPersona.instructions).toContain('这边已经帮你');
		expect(sweetPersonaMarkdown).toBe(sweetPersonaText);
		expect(energeticPersona.name).toBe('元气搭子');
		expect(energeticPersona.fish?.referenceId).toBe('fbe02f8306fc4d3d915e9871722a39d5');
		expect(energeticPersona.edge?.rate).toBe('+12%');
		expect(energeticPersona.instructions).toContain('一直在线同步进度');
	});
});

describe('voice-brief volume 解析', () => {
	const resolveVolume = (provider: string, providers: VoiceBriefConfig['providers'], persona?: Partial<VoicePersona>) => {
		const service = new VoiceBriefRuntimeService({} as VoiceBriefRuntimeModule);
		const target = service as unknown as {
			resolveVolume(provider: string, config: VoiceBriefConfig, persona?: VoicePersona): number | undefined;
		};
		return target.resolveVolume(provider, { providers } as VoiceBriefConfig, persona as VoicePersona);
	};

	test('未配置时返回 undefined', () => {
		expect(resolveVolume('audiocpp', {})).toBeUndefined();
	});

	test('读取全局 provider 配置的 volume', () => {
		expect(resolveVolume('audiocpp', { audiocpp: { volume: 1.4 } })).toBe(1.4);
		expect(resolveVolume('fish', { fish: { volume: 0.8 } })).toBe(0.8);
		expect(resolveVolume('edge', { edge: { volume: 0.5 } })).toBe(0.5);
		expect(resolveVolume('openai', { openai: { volume: 2 } })).toBe(2);
	});

	test('人设配置优先于全局配置', () => {
		expect(resolveVolume('audiocpp', { audiocpp: { volume: 1.4 } }, { audiocpp: { volume: 0.7 } })).toBe(0.7);
		expect(resolveVolume('audiocpp', {}, { audiocpp: { volume: 0.7 } })).toBe(0.7);
	});

	test('未知 provider 返回 undefined', () => {
		expect(resolveVolume('unknown', {})).toBeUndefined();
	});
});

import { parseValue } from '../../infrastructure/schema';
import fs from 'node:fs/promises';
import path from 'node:path';
import voiceBriefSkillTemplate from '../templates/SKILL.md';
import voiceBriefTemplate from '../templates/voice-brief.md';
import { VoiceBriefConfigModule } from '../../config';
import { hasErrorCode } from '../../error';
import { VoiceBriefPersonaModule } from '../../persona';
import { ClaudeSettingsSchema } from '../schema';
import type { ClaudeSettings } from '../schema';
import type { VoicePersona } from '../../persona/types';
import type { InstallOptions, InstallPlan, InstallTarget, InstallVerboseValue } from '../types';
import type { VoiceBriefInstallModule } from '../index';

const ClaudeVoiceBriefPermission = 'Bash(voice-brief:*)';
const SharedSkillTargets = ['codex', 'opencode', 'copilot', 'pi', 'kimi-code', 'zcode'] as const;

type SharedSkillTarget = typeof SharedSkillTargets[number];

export class VoiceBriefInstallService {
	constructor(readonly module: VoiceBriefInstallModule) {}

	async install(personaName: string, target: InstallTarget, options?: InstallOptions) {
		const normalized = this.normalizeInstallOptions(options);
		const personaModule = this.getPersonaModule();
		await personaModule.personaService.ensureBundledPersonas();
		const persona = await personaModule.personaService.load(personaName);
		if (target === 'codex') return this.installCodex(persona, normalized);
		if (target === 'claude') return this.installClaude(persona, normalized);
		if (target === 'opencode') return this.installOpenCode(persona, normalized);
		if (target === 'copilot') return this.installCopilot(persona, normalized);
		if (target === 'pi') return this.installPi(persona, normalized);
		if (target === 'kimi-code') return this.installKimiCode(persona, normalized);
		if (target === 'zcode') return this.installZcode(persona, normalized);
		throw new Error(`未知安装目标: ${target}`);
	}

	async uninstall(target: InstallTarget, options?: InstallOptions) {
		const normalized = this.normalizeInstallOptions(options);
		if (target === 'codex') return this.uninstallCodex(normalized);
		if (target === 'claude') return this.uninstallClaude(normalized);
		if (target === 'opencode') return this.uninstallOpenCode(normalized);
		if (target === 'copilot') return this.uninstallCopilot(normalized);
		if (target === 'pi') return this.uninstallPi(normalized);
		if (target === 'kimi-code') return this.uninstallKimiCode(normalized);
		if (target === 'zcode') return this.uninstallZcode(normalized);
		throw new Error(`未知安装目标: ${target}`);
	}

	parseInstallTarget(value: string): InstallTarget {
		if (value === 'codex' || value === 'claude' || value === 'opencode' || value === 'copilot' || value === 'pi' || value === 'kimi-code' || value === 'zcode') return value;
		throw new Error(`未知安装目标: ${value}`);
	}

	parseVerboseValue(value: InstallVerboseValue | undefined) {
		if (value === undefined) return undefined;
		if (value === 'true' || value === 'on') return true;
		return false;
	}

	private async installCodex(persona: VoicePersona, options: Required<InstallOptions>): Promise<InstallPlan> {
		const agentsFile = await this.getCodexAgentsFile();
		return this.installSharedSkillTarget(persona, 'codex', agentsFile, 'Codex', options);
	}

	private async installClaude(persona: VoicePersona, options: Required<InstallOptions>): Promise<InstallPlan> {
		const claudeHome = this.getConfigModule().pathService.resolveClaudeHome();
		const targetFile = path.join(claudeHome, 'CLAUDE.md');
		const skillFile = path.join(claudeHome, 'skills', 'voice-brief', 'SKILL.md');
		const settingsFile = path.join(claudeHome, 'settings.json');
		const current = await this.readText(targetFile);
		const settings = await this.readText(settingsFile);
		await this.writeText(targetFile, this.module.markerBlockService.upsert(current, 'claude', this.renderPromptTemplate(persona, 'claude', options.verbose)), options.dryRun);
		await this.writeText(skillFile, voiceBriefSkillTemplate, options.dryRun);
		await this.writeText(settingsFile, this.renderClaudeSettings(settings, true), options.dryRun);
		return {
			action: 'install',
			dryRun: options.dryRun,
			persona: persona.name,
			verbose: options.verbose,
			target: 'claude',
			files: [targetFile, skillFile, settingsFile],
			messages: [`Claude Code 已安装人设: ${persona.name}，过程播报: ${options.verbose ? '开启' : '关闭'}`],
		};
	}

	private async installOpenCode(persona: VoicePersona, options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = await this.getOpenCodeAgentsFile();
		return this.installSharedSkillTarget(persona, 'opencode', targetFile, 'OpenCode', options);
	}

	private async installCopilot(persona: VoicePersona, options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = this.getCopilotInstructionsFile();
		return this.installSharedSkillTarget(persona, 'copilot', targetFile, 'GitHub Copilot', options);
	}

	private async uninstallCodex(options: Required<InstallOptions>): Promise<InstallPlan> {
		const agentsFile = await this.getCodexAgentsFile();
		const skillFile = this.getSharedSkillFile();
		const current = await this.readText(agentsFile);
		await this.writeText(agentsFile, this.module.markerBlockService.remove(current, 'codex'), options.dryRun);
		await this.removeSharedSkillIfUnused('codex', skillFile, options.dryRun);
		return {
			action: 'uninstall',
			dryRun: options.dryRun,
			target: 'codex',
			files: [agentsFile, skillFile],
			messages: ['Codex voice-brief 配置已移除'],
		};
	}

	private async uninstallClaude(options: Required<InstallOptions>): Promise<InstallPlan> {
		const claudeHome = this.getConfigModule().pathService.resolveClaudeHome();
		const targetFile = path.join(claudeHome, 'CLAUDE.md');
		const skillFile = path.join(claudeHome, 'skills', 'voice-brief', 'SKILL.md');
		const settingsFile = path.join(claudeHome, 'settings.json');
		const current = await this.readText(targetFile);
		const settings = await this.readText(settingsFile);
		await this.writeText(targetFile, this.module.markerBlockService.remove(current, 'claude'), options.dryRun);
		const nextSettings = this.renderClaudeSettings(settings, false);
		if (nextSettings !== undefined) {
			await this.writeText(settingsFile, nextSettings, options.dryRun);
		}
		if (!options.dryRun) {
			await fs.rm(skillFile, { force: true });
		}
		return {
			action: 'uninstall',
			dryRun: options.dryRun,
			target: 'claude',
			files: [targetFile, skillFile, settingsFile],
			messages: ['Claude Code voice-brief 配置已移除'],
		};
	}

	private async uninstallOpenCode(options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = await this.getOpenCodeAgentsFile();
		const skillFile = this.getSharedSkillFile();
		const current = await this.readText(targetFile);
		await this.writeText(targetFile, this.module.markerBlockService.remove(current, 'opencode'), options.dryRun);
		await this.removeSharedSkillIfUnused('opencode', skillFile, options.dryRun);
		return {
			action: 'uninstall',
			dryRun: options.dryRun,
			target: 'opencode',
			files: [targetFile, skillFile],
			messages: ['OpenCode voice-brief 配置已移除'],
		};
	}

	private async uninstallCopilot(options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = this.getCopilotInstructionsFile();
		const skillFile = this.getSharedSkillFile();
		const current = await this.readText(targetFile);
		await this.writeText(targetFile, this.module.markerBlockService.remove(current, 'copilot'), options.dryRun);
		await this.removeSharedSkillIfUnused('copilot', skillFile, options.dryRun);
		return {
			action: 'uninstall',
			dryRun: options.dryRun,
			target: 'copilot',
			files: [targetFile, skillFile],
			messages: ['GitHub Copilot voice-brief 配置已移除'],
		};
	}

	private async installPi(persona: VoicePersona, options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = this.getPiAgentsFile();
		return this.installSharedSkillTarget(persona, 'pi', targetFile, 'Pi', options);
	}

	private async installKimiCode(persona: VoicePersona, options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = this.getKimiCodeAgentsFile();
		return this.installSharedSkillTarget(persona, 'kimi-code', targetFile, 'Kimi Code', options);
	}

	private async installZcode(persona: VoicePersona, options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = this.getZcodeAgentsFile();
		return this.installSharedSkillTarget(persona, 'zcode', targetFile, 'ZCode', options);
	}

	private async uninstallPi(options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = this.getPiAgentsFile();
		const skillFile = this.getSharedSkillFile();
		const current = await this.readText(targetFile);
		await this.writeText(targetFile, this.module.markerBlockService.remove(current, 'pi'), options.dryRun);
		await this.removeSharedSkillIfUnused('pi', skillFile, options.dryRun);
		return {
			action: 'uninstall',
			dryRun: options.dryRun,
			target: 'pi',
			files: [targetFile, skillFile],
			messages: ['Pi voice-brief 配置已移除'],
		};
	}

	private async uninstallKimiCode(options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = this.getKimiCodeAgentsFile();
		const skillFile = this.getSharedSkillFile();
		const current = await this.readText(targetFile);
		await this.writeText(targetFile, this.module.markerBlockService.remove(current, 'kimi-code'), options.dryRun);
		await this.removeSharedSkillIfUnused('kimi-code', skillFile, options.dryRun);
		return {
			action: 'uninstall',
			dryRun: options.dryRun,
			target: 'kimi-code',
			files: [targetFile, skillFile],
			messages: ['Kimi Code voice-brief 配置已移除'],
		};
	}

	private async uninstallZcode(options: Required<InstallOptions>): Promise<InstallPlan> {
		const targetFile = this.getZcodeAgentsFile();
		const skillFile = this.getSharedSkillFile();
		const current = await this.readText(targetFile);
		await this.writeText(targetFile, this.module.markerBlockService.remove(current, 'zcode'), options.dryRun);
		await this.removeSharedSkillIfUnused('zcode', skillFile, options.dryRun);
		return {
			action: 'uninstall',
			dryRun: options.dryRun,
			target: 'zcode',
			files: [targetFile, skillFile],
			messages: ['ZCode voice-brief 配置已移除'],
		};
	}

	private async installSharedSkillTarget(persona: VoicePersona, target: SharedSkillTarget, targetFile: string, targetName: string, options: Required<InstallOptions>): Promise<InstallPlan> {
		const skillFile = this.getSharedSkillFile();
		const current = await this.readText(targetFile);
		await this.writeText(targetFile, this.module.markerBlockService.upsert(current, target, this.renderPromptTemplate(persona, target, options.verbose)), options.dryRun);
		await this.writeText(skillFile, voiceBriefSkillTemplate, options.dryRun);
		return {
			action: 'install',
			dryRun: options.dryRun,
			persona: persona.name,
			verbose: options.verbose,
			target,
			files: [targetFile, skillFile],
			messages: [`${targetName} 已安装人设: ${persona.name}，过程播报: ${options.verbose ? '开启' : '关闭'}`],
		};
	}

	private async getCodexAgentsFile() {
		const codexHome = this.getConfigModule().pathService.resolveCodexHome();
		const override = path.join(codexHome, 'AGENTS.override.md');
		const overrideText = await this.readText(override);
		if (overrideText.trim()) return override;
		return path.join(codexHome, 'AGENTS.md');
	}

	private async getOpenCodeAgentsFile() {
		const configDir = await this.getConfigModule().pathService.resolveOpenCodeConfigDir();
		return path.join(configDir, 'AGENTS.md');
	}

	private getCopilotInstructionsFile() {
		return path.join(this.getConfigModule().pathService.resolveCopilotHome(), 'copilot-instructions.md');
	}

	private getPiAgentsFile() {
		return path.join(this.getConfigModule().pathService.resolvePiHome(), 'AGENTS.md');
	}

	private getKimiCodeAgentsFile() {
		return path.join(this.getConfigModule().pathService.resolveKimiCodeHome(), 'AGENTS.md');
	}

	private getZcodeAgentsFile() {
		return path.join(this.getConfigModule().pathService.resolveZcodeHome(), 'AGENTS.md');
	}

	private renderPromptTemplate(persona: VoicePersona, agent: InstallTarget, verbose: boolean) {
		return this.renderProgressBlocks(voiceBriefTemplate, verbose)
			.replaceAll('{{agent}}', this.shellDoubleQuotedValue(agent))
			.replaceAll('{{personaName}}', this.shellDoubleQuotedValue(persona.name))
			.replace('{{personaInstructions}}', this.personaInstructions(persona));
	}

	private renderClaudeSettings(text: string, enabled: boolean) {
		if (!enabled && !text.trim()) return undefined;
		const settings = this.parseClaudeSettings(text);
		const permissions = { ...settings.permissions };
		const currentAllow = [...(permissions.allow ?? [])];
		const allow = enabled
			? this.appendUnique(currentAllow, ClaudeVoiceBriefPermission)
			: currentAllow.filter(item => item !== ClaudeVoiceBriefPermission);
		if (allow.length > 0) {
			permissions.allow = allow;
		} else {
			delete permissions.allow;
		}
		if (Object.keys(permissions).length > 0) {
			settings.permissions = permissions;
		} else {
			delete settings.permissions;
		}
		return `${JSON.stringify(settings, null, '\t')}\n`;
	}

	private renderProgressBlocks(template: string, verbose: boolean) {
		const enabledBlock = verbose ? 'on' : 'off';
		return template
			.replace(/<!-- voice-brief:progress:(off|on):start -->\n?([\s\S]*?)\n?<!-- voice-brief:progress:\1:end -->/g, (_block: string, mode: string, content: string) => {
				if (mode !== enabledBlock) return '';
				return content.trim();
			})
			.replace(/\n{3,}/g, '\n\n');
	}

	private personaInstructions(persona: VoicePersona) {
		if (!persona.instructions) throw new Error(`人设 ${persona.name} 缺少提示词正文`);
		return persona.instructions;
	}

	private async removeSharedSkillIfUnused(target: SharedSkillTarget, skillFile: string, dryRun: boolean) {
		if (dryRun || await this.isSharedSkillStillUsedByOtherTarget(target)) return;
		await fs.rm(skillFile, { force: true });
	}

	private async isSharedSkillStillUsedByOtherTarget(target: SharedSkillTarget) {
		for (const otherTarget of SharedSkillTargets) {
			if (otherTarget === target) continue;
			if (this.hasVoiceBriefMarker(await this.readText(await this.getSharedTargetPromptFile(otherTarget)), otherTarget)) return true;
		}
		return false;
	}

	private async getSharedTargetPromptFile(target: SharedSkillTarget) {
		if (target === 'codex') return this.getCodexAgentsFile();
		if (target === 'opencode') return this.getOpenCodeAgentsFile();
		if (target === 'pi') return this.getPiAgentsFile();
		if (target === 'kimi-code') return this.getKimiCodeAgentsFile();
		if (target === 'zcode') return this.getZcodeAgentsFile();
		return this.getCopilotInstructionsFile();
	}

	private hasVoiceBriefMarker(text: string, id: string) {
		return text.includes(`<!-- voice-brief:${id}:start -->`);
	}

	private getSharedSkillFile() {
		return path.join(this.getConfigModule().pathService.resolveAgentsHome(), 'skills', 'voice-brief', 'SKILL.md');
	}

	private parseClaudeSettings(text: string): ClaudeSettings {
		if (!text.trim()) return {};
		return parseValue(ClaudeSettingsSchema, JSON.parse(text));
	}

	private appendUnique(items: string[], value: string) {
		if (items.includes(value)) return items;
		return [...items, value];
	}

	private shellDoubleQuotedValue(value: string) {
		return value.replace(/["\\$`]/g, match => `\\${match}`);
	}

	private async readText(file: string) {
		try {
			return await fs.readFile(file, 'utf-8');
		} catch (error) {
			if (hasErrorCode(error, 'ENOENT')) return '';
			throw error;
		}
	}

	private async writeText(file: string, text: string, dryRun: boolean) {
		if (dryRun) return;
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, text, 'utf-8');
	}

	private normalizeInstallOptions(options?: InstallOptions): Required<InstallOptions> {
		return {
			dryRun: options?.dryRun ?? false,
			verbose: options?.verbose ?? true,
		};
	}

	private getConfigModule() {
		return this.module.app.getModule(VoiceBriefConfigModule);
	}

	private getPersonaModule() {
		return this.module.app.getModule(VoiceBriefPersonaModule);
	}
}

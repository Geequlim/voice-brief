import { parseValue } from '../../infrastructure/schema';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import defaultPersonaText from '../templates/默认中文助理.md';
import intellectualPersonaText from '../templates/知性姐姐.md';
import sweetPersonaText from '../templates/甜妹助理.md';
import energeticPersonaText from '../templates/元气搭子.md';
import { VoiceBriefConfigModule } from '../../config';
import { hasErrorCode } from '../../error';
import { VoicePersonaFrontMatterSchema } from '../schema';
import type { VoicePersona } from '../types';
import type { VoiceBriefPersonaModule } from '../index';

export class VoiceBriefPersonaService {
	constructor(readonly module: VoiceBriefPersonaModule) {}

	async ensureBundledPersonas(force = false) {
		const configModule = this.getConfigModule();
		const paths = await configModule.pathService.resolveVoiceBriefPaths();
		await configModule.pathService.ensureVoiceBriefDirs(paths);
		for (const template of this.bundledPersonas()) {
			const target = path.join(paths.personaDir, template.fileName);
			if (force) {
				await fs.writeFile(target, template.text, 'utf-8');
				continue;
			}
			try {
				await fs.access(target);
			} catch (error) {
				if (!hasErrorCode(error, 'ENOENT')) throw error;
				await fs.writeFile(target, template.text, 'utf-8');
			}
		}
	}

	async list() {
		const paths = await this.getPaths();
		await this.getConfigModule().pathService.ensureVoiceBriefDirs(paths);
		const entries = await fs.readdir(paths.personaDir, { withFileTypes: true });
		return entries
			.filter(entry => entry.isFile() && entry.name.endsWith('.md'))
			.map(entry => path.basename(entry.name, '.md'))
			.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
	}

	async load(name: string) {
		const fileName = this.normalizeFileName(name);
		const text = await this.readMarkdown(name);
		return this.parsePersona(fileName, text);
	}

	async readMarkdown(name: string) {
		const paths = await this.getPaths();
		const fileName = this.normalizeFileName(name);
		const file = path.join(paths.personaDir, fileName);
		return fs.readFile(file, 'utf-8');
	}

	normalizeFileName(name: string) {
		const trimmed = name.trim();
		if (!trimmed) throw new Error('人设文件名不能为空');
		if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
			throw new Error(`非法人设文件名: ${name}`);
		}
		if (trimmed.endsWith('.md')) return trimmed;
		return `${trimmed}.md`;
	}

	private async getPaths() {
		return this.getConfigModule().pathService.resolveVoiceBriefPaths();
	}

	private bundledPersonas() {
		return [
			{ fileName: this.getConfigModule().configService.examplePersonaFile, text: defaultPersonaText },
			{ fileName: '知性姐姐.md', text: intellectualPersonaText },
			{ fileName: '甜妹助理.md', text: sweetPersonaText },
			{ fileName: '元气搭子.md', text: energeticPersonaText },
		];
	}

	private getConfigModule() {
		return this.module.app.getModule(VoiceBriefConfigModule);
	}

	private parsePersona(fileName: string, text: string): VoicePersona {
		const parsed = matter(text);
		const frontMatter = parseValue(VoicePersonaFrontMatterSchema, parsed.data);

		return {
			...frontMatter,
			fileName,
			name: path.basename(fileName, '.md'),
			instructions: parsed.content.trim(),
		};
	}
}

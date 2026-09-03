#!/usr/bin/env node
/**
 * 文档一致性检查：
 * - 英文/中文文档一一对应
 * - 每页首行是语言切换，且互相指回对方
 * - 仓库内链接（相对路径与 GitHub blob 地址）指向真实文件
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(fileURLToPath(new URL('..', import.meta.url))));
const repoBlobPrefix = 'https://github.com/Geequlim/voice-brief/blob/main/';

const documentPairs = [
	['README.md', 'README.zh-CN.md'],
	['CONTRIBUTING.md', 'CONTRIBUTING.zh-CN.md'],
	['docs/configuration.md', 'docs/zh-CN/configuration.md'],
	['docs/tts-and-personas.md', 'docs/zh-CN/tts-and-personas.md'],
	['docs/hooks.md', 'docs/zh-CN/hooks.md'],
	['docs/alignment.md', 'docs/zh-CN/alignment.md'],
	['docs/linux-ducking.md', 'docs/zh-CN/linux-ducking.md'],
	['packages/cinnamon/README.md', 'packages/cinnamon/README.zh-CN.md'],
];

const problems = [];

function extractLinks(text: string): string[] {
	const links: string[] = [];
	const pattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
	for (const match of text.matchAll(pattern)) links.push(match[1]!);
	return links;
}

function resolveRepoPath(fromFile: string, link: string): string {
	return normalize(join(dirname(fromFile), decodeURIComponent(link)));
}

function findLinkProblem(file: string, link: string): string | null {
	if (link.startsWith('#')) return null;
	if (link.startsWith(repoBlobPrefix)) {
		const target = normalize(decodeURIComponent(link.slice(repoBlobPrefix.length)));
		if (!existsSync(join(root, target))) return `broken repository link: ${link}`;
		return null;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return null;
	const target = resolveRepoPath(file, link);
	if (!existsSync(join(root, target))) return `broken relative link: ${link}`;
	return null;
}

function firstLine(text: string): string {
	return text.split('\n', 1)[0] ?? '';
}

function switchLinksTo(file: string, line: string, target: string): boolean {
	for (const link of extractLinks(line)) {
		if (link.startsWith(repoBlobPrefix)) {
			if (normalize(decodeURIComponent(link.slice(repoBlobPrefix.length))) === normalize(target)) return true;
			continue;
		}
		if (link.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
		if (resolveRepoPath(file, link) === normalize(target)) return true;
	}
	return false;
}

for (const [english, chinese] of documentPairs) {
	for (const file of [english, chinese]) {
		if (!existsSync(join(root, file))) problems.push(`missing document: ${file}`);
	}
	if (problems.length > 0) continue;

	const englishText = await readFile(join(root, english), 'utf8');
	const chineseText = await readFile(join(root, chinese), 'utf8');

	for (const [file, text] of [[english, englishText], [chinese, chineseText]]) {
		const line = firstLine(text);
		if (!line.includes('English') || !line.includes('简体中文')) {
			problems.push(`${file}: first line is not a language switch`);
		}
		for (const link of extractLinks(text)) {
			const problem = findLinkProblem(file, link);
			if (problem) problems.push(`${file}: ${problem}`);
		}
	}

	if (!switchLinksTo(english, firstLine(englishText), chinese)) {
		problems.push(`${english}: language switch does not point to ${chinese}`);
	}
	if (!switchLinksTo(chinese, firstLine(chineseText), english)) {
		problems.push(`${chinese}: language switch does not point to ${english}`);
	}
}

if (problems.length > 0) {
	console.error(`[check-docs] ${problems.length} problem(s) found:`);
	for (const problem of problems) console.error(`[check-docs] - ${problem}`);
	process.exit(1);
}
console.log(`[check-docs] ${documentPairs.length * 2} documents checked, all links and language switches are valid`);

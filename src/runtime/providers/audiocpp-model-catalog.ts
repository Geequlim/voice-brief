import http from '../../infrastructure/http';
import path from 'node:path';

export type AudioCppCatalogEntry = {
	id: string;
	family?: string;
	path?: string;
	task?: string;
	mode?: string;
};

export type AudioCppModelSource = {
	family: string;
	path: string;
	task: string;
	mode: string;
};

export async function resolveAudioCppModelSource(options: {
	baseUrl: string;
	family?: string;
	model?: string;
	modelPath?: string;
	task: string;
	headers: Record<string, string>;
	cache: Map<string, Map<string, AudioCppCatalogEntry>>;
}): Promise<AudioCppModelSource | undefined> {
	if (options.family && options.modelPath) return { family: options.family, path: options.modelPath, task: options.task, mode: 'offline' };
	if (!options.model) return undefined;
	let catalog = options.cache.get(options.baseUrl);
	if (!catalog) {
		catalog = await parseCatalog(options.baseUrl, options.headers);
		options.cache.set(options.baseUrl, catalog);
	}
	const entry = catalog.get(options.model);
	if (!entry?.family || !entry.path) return undefined;
	return {
		family: entry.family,
		path: entry.path,
		task: entry.task ?? options.task,
		mode: entry.mode ?? 'offline',
	};
}

async function parseCatalog(baseUrl: string, headers: Record<string, string>) {
	const catalog = new Map<string, AudioCppCatalogEntry>();
	try {
		const root = await http.get<{ models_root?: string; }>(joinUrl(baseUrl, 'ui/models-root'), undefined, headers);
		const html = await http.get<string>(new URL(baseUrl).origin, undefined, headers);
		for (const entry of extractCatalogEntries(html)) {
			entry.path = resolveModelPath(entry.path ?? '', root.models_root ?? '/app/models');
			catalog.set(entry.id, entry);
		}
	} catch {}
	return catalog;
}

function joinUrl(baseUrl: string, pathname: string) {
	return `${baseUrl.replace(/\/+$/, '')}/${pathname}`;
}

function resolveModelPath(modelPath: string, modelsRoot: string) {
	if (path.isAbsolute(modelPath)) return modelPath;
	return path.join(path.dirname(modelsRoot), modelPath);
}

function extractCatalogEntries(html: string) {
	const entries: AudioCppCatalogEntry[] = [];
	const seen = new Set<string>();
	let cursor = 0;
	while (entries.length < 200) {
		const marker = html.indexOf('"id":"', cursor);
		if (marker < 0) break;
		cursor = marker + 6;
		const end = extractJsonEntry(html, marker);
		if (end < 0) continue;
		const start = html.lastIndexOf('{', marker);
		try {
			const entry = JSON.parse(html.slice(start, end)) as AudioCppCatalogEntry;
			if (entry?.id && entry.family && entry.path && !seen.has(entry.id)) {
				seen.add(entry.id);
				entries.push(entry);
			}
		} catch {}
	}
	return entries;
}

function extractJsonEntry(html: string, marker: number) {
	const start = html.lastIndexOf('{', marker);
	if (start < 0) return -1;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < html.length; i++) {
		const ch = html[i];
		if (escaped) { escaped = false; continue; }
		if (ch === '\\') { escaped = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '{') depth++;
		if (ch === '}') {
			depth--;
			if (depth === 0) return i + 1;
		}
	}
	return -1;
}

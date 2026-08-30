import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { VoiceBriefConfig, VoiceBriefState } from '../../config/schema';
import type { VoiceBriefPaths } from '../../config/types';
import { hasErrorCode } from '../../error';
import type { ProviderCacheDescriptor } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';

interface CacheFileEntry {
	file: string;
	mtimeMs: number;
}

export class VoiceBriefCacheService {
	constructor(readonly module: VoiceBriefRuntimeModule) {}

	createCacheKey(provider: string, text: string, descriptor: ProviderCacheDescriptor) {
		const payload = this.stableValue({
			provider,
			text,
			keyData: descriptor.keyData,
		});
		return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
	}

	resolveCacheFile(paths: VoiceBriefPaths, provider: string, cacheKey: string, extension: string) {
		return path.join(paths.cacheDir, provider, `${cacheKey}.${this.normalizeExtension(extension)}`);
	}

	async readFreshCacheFile(file: string, ttlMs: number) {
		try {
			const stat = await fs.stat(file);
			if (ttlMs > 0 && Date.now() - stat.mtimeMs > ttlMs) {
				await fs.rm(file, { force: true });
				return undefined;
			}
			const now = new Date();
			await fs.utimes(file, now, now);
			return file;
		} catch (error) {
			if (hasErrorCode(error, 'ENOENT')) return undefined;
			throw error;
		}
	}

	async storeCacheFile(sourceFile: string, targetFile: string) {
		await fs.mkdir(path.dirname(targetFile), { recursive: true });
		const tempFile = `${targetFile}.${process.pid}.${randomUUID()}.tmp`;
		await fs.copyFile(sourceFile, tempFile);
		await fs.rename(tempFile, targetFile);
	}

	async pruneIfNeeded(paths: VoiceBriefPaths, config: VoiceBriefConfig, state: VoiceBriefState) {
		if (!config.cache.enabled) return;
		if (config.cache.pruneIntervalMs > 0 && state.lastCachePruneAt && Date.now() - state.lastCachePruneAt < config.cache.pruneIntervalMs) {
			return;
		}

		const files = await this.listCacheFiles(paths.cacheDir);
		const freshFiles: CacheFileEntry[] = [];
		for (const file of files) {
			const stat = await fs.stat(file);
			if (config.cache.ttlMs > 0 && Date.now() - stat.mtimeMs > config.cache.ttlMs) {
				await fs.rm(file, { force: true });
				continue;
			}
			freshFiles.push({ file, mtimeMs: stat.mtimeMs });
		}

		const limit = config.cache.maxEntries;
		if (limit > 0 && freshFiles.length > limit) {
			freshFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);
			const overflow = freshFiles.length - limit;
			for (const entry of freshFiles.slice(0, overflow)) {
				await fs.rm(entry.file, { force: true });
			}
		}

		state.lastCachePruneAt = Date.now();
	}

	private normalizeExtension(extension: string) {
		const value = extension.replace(/^\.+/, '').trim();
		if (!value || value.includes('/') || value.includes('\\')) throw new Error(`非法缓存扩展名: ${extension}`);
		return value;
	}

	private stableValue(value: unknown): unknown {
		if (Array.isArray(value)) return value.map(item => this.stableValue(item));
		if (this.isRecord(value)) {
			const result: Record<string, unknown> = {};
			for (const key of Object.keys(value).sort()) {
				const next = this.stableValue(value[key]);
				if (next !== undefined) result[key] = next;
			}
			return result;
		}
		if (value === undefined) return undefined;
		if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
		return String(value);
	}

	private async listCacheFiles(dir: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			const files: string[] = [];
			for (const entry of entries) {
				const file = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					files.push(...(await this.listCacheFiles(file)));
					continue;
				}
				if (entry.isFile()) files.push(file);
			}
			return files;
		} catch (error) {
			if (hasErrorCode(error, 'ENOENT')) return [];
			throw error;
		}
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}
}

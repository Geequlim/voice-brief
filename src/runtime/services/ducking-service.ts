import { parseValue, checkValue } from '../../infrastructure/schema';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { VoiceBriefConfig } from '../../config/schema';
import type { VoiceBriefPaths } from '../../config/types';
import { hasErrorCode } from '../../error';
import { VOICE_BRIEF_PLAYER_APPLICATION_NAME } from '../types';
import { DuckingJournalSchema, PactlSinkInputsSchema } from '../schema';
import type { DuckingJournal, DuckingStream, PactlSinkInput } from '../schema';
import type { DuckingCheckResult } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';

// PipeWire 会把按应用记忆的音量按百分比量化，压低值回流后和写入值可能有小幅偏差，匹配泄漏时按 1% 容差比较
const DUCKED_VOLUME_MATCH_TOLERANCE = 0.01;
const CINNAMON_SMOKE_APPLICATION_NAME = 'voice-brief-cinnamon-smoke';

export class VoiceBriefDuckingService {
	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async check(config: VoiceBriefConfig): Promise<DuckingCheckResult> {
		if (!config.playback.ducking.enabled) {
			return {
				available: false,
				enabled: false,
				message: '音频压低已通过配置关闭',
			};
		}
		if (process.platform !== 'linux') {
			return {
				available: false,
				enabled: true,
				message: '音频压低仅支持 Linux',
			};
		}

		try {
			await this.loadSinkInputs();
			return {
				available: true,
				enabled: true,
				message: `音频压低可用: ${config.playback.ducking.attenuationDb} dB`,
			};
		} catch {
			return {
				available: false,
				enabled: true,
				message: '音频压低不可用，需要 pactl 和可连接的 PulseAudio/PipeWire-Pulse 服务',
			};
		}
	}

	async playWithDucking(paths: VoiceBriefPaths, config: VoiceBriefConfig, play: () => Promise<void>) {
		if (!config.playback.ducking.enabled || process.platform !== 'linux') {
			await play();
			return;
		}

		try {
			await this.loadSinkInputs();
		} catch {
			await play();
			return;
		}

		let journal: DuckingJournal | undefined;
		try {
			journal = await this.createSessionJournal(paths, config);
			await this.writeJournal(paths, journal);
			await this.applyVolumes(journal.streams, 'duckedVolumes');
		} catch {
			if (journal) await this.settleDuckingJournal(paths, journal, config.playback.ducking.restoreFadeMs);
			await play();
			return;
		}

		try {
			await play();
		} finally {
			await this.settleDuckingJournal(paths, journal, config.playback.ducking.restoreFadeMs);
		}
	}

	protected async runPactl(args: string[]) {
		return new Promise<string>((resolve, reject) => {
			execFile('pactl', args, { encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(stdout);
			});
		});
	}

	protected async delay(durationMs: number) {
		await new Promise(resolve => setTimeout(resolve, durationMs));
	}

	private async createJournal(config: VoiceBriefConfig, pending?: DuckingStream[]): Promise<DuckingJournal> {
		const sinkInputs = await this.loadSinkInputs();
		const attenuationFactor = 10 ** (-config.playback.ducking.attenuationDb / 60);
		return {
			pid: process.pid,
			streams: sinkInputs.filter(input => !input.corked && !this.isDuckingExcluded(input)).map(input => {
				const originalVolumes = this.streamVolumes(input);
				return {
					index: input.index,
					restoreId: input.properties?.['module-stream-restore.id'],
					originalVolumes,
					duckedVolumes: originalVolumes.map(volume => Math.round(volume * attenuationFactor)),
				};
			}),
			pending,
		};
	}

	// 恢复上一次遗留的压低日志，并把其中仍无法修复的泄漏条目带进本次会话继续跟踪
	private async createSessionJournal(paths: VoiceBriefPaths, config: VoiceBriefConfig): Promise<DuckingJournal> {
		const previous = await this.loadJournal(paths);
		let pending: DuckingStream[] | undefined;
		if (previous && !this.processExists(previous.pid)) {
			pending = await this.settleDuckingJournal(paths, previous, config.playback.ducking.restoreFadeMs);
		}
		return this.createJournal(config, pending);
	}

	private async loadSinkInputs() {
		const text = await this.runPactl(['--format=json', 'list', 'sink-inputs']);
		return parseValue(PactlSinkInputsSchema, JSON.parse(text));
	}

	private async applyVolumes(streams: DuckingStream[], key: 'originalVolumes' | 'duckedVolumes') {
		for (const stream of streams) {
			await this.applyStreamVolumes(stream, stream[key]);
		}
	}

	private async applyStreamVolumes(stream: DuckingStream, volumes: number[]) {
		await this.runPactl(['set-sink-input-volume', String(stream.index), ...volumes.map(String)]);
	}

	// 按 index 恢复压低音量，返回本次未能恢复的流；这些流要么已消失，要么音量被外部改动
	private async restoreStreams(streams: DuckingStream[], fadeDurationMs: number): Promise<DuckingStream[]> {
		let current: PactlSinkInput[];
		try {
			current = await this.loadSinkInputs();
		} catch {
			return streams;
		}
		const currentByIndex = new Map(current.map(input => [input.index, input]));
		const restorableStreams: DuckingStream[] = [];
		const unresolved: DuckingStream[] = [];
		for (const stream of streams) {
			const input = currentByIndex.get(stream.index);
			if (input && this.sameVolumes(this.streamVolumes(input), stream.duckedVolumes)) restorableStreams.push(stream);
			else unresolved.push(stream);
		}
		if (restorableStreams.length === 0) return unresolved;
		if (fadeDurationMs === 0) {
			const failed: DuckingStream[] = [];
			for (const stream of restorableStreams) {
				try {
					await this.applyStreamVolumes(stream, stream.originalVolumes);
				} catch {
					failed.push(stream);
				}
			}
			return [...unresolved, ...failed];
		}

		const failed: DuckingStream[] = [];
		let activeStreams = restorableStreams;
		const stepCount = Math.max(1, Math.ceil(fadeDurationMs / 50));
		const stepDurationMs = fadeDurationMs / stepCount;
		for (let step = 1; step <= stepCount; step++) {
			if (activeStreams.length === 0) break;
			await this.delay(stepDurationMs);
			const progress = step / stepCount;
			const nextStreams: DuckingStream[] = [];
			for (const stream of activeStreams) {
				const volumes = step === stepCount ? stream.originalVolumes : stream.originalVolumes.map((originalVolume, index) => {
					const duckedVolume = stream.duckedVolumes[index];
					if (originalVolume === 0) return 0;
					if (duckedVolume === 0) return Math.round(originalVolume * progress);
					return Math.round(duckedVolume * ((originalVolume / duckedVolume) ** progress));
				});
				try {
					await this.applyStreamVolumes(stream, volumes);
					nextStreams.push(stream);
				} catch {
					failed.push(stream);
				}
			}
			activeStreams = nextStreams;
		}
		return [...unresolved, ...failed];
	}

	private processExists(pid: number) {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return hasErrorCode(error, 'EPERM');
		}
	}

	// 结束一次压低会话：先按 index 恢复本次压低的流，再把无法立即恢复的泄漏登记成按规则跟踪的待修复条目；
	// 返回仍需跟踪的待修复条目，全部处理完时移除日志文件
	private async settleDuckingJournal(paths: VoiceBriefPaths, journal: DuckingJournal, restoreFadeMs: number): Promise<DuckingStream[]> {
		const unresolved = await this.restoreStreams(journal.streams, restoreFadeMs);
		const pending = await this.repairPendingEntries([...(journal.pending ?? []), ...unresolved]);
		if (pending.length === 0) {
			await this.removeJournal(paths);
			return pending;
		}
		await this.writeJournal(paths, { pid: process.pid, streams: [], pending });
		return pending;
	}

	private async repairPendingEntries(candidates: DuckingStream[]) {
		const deduped: DuckingStream[] = [];
		for (const entry of candidates) {
			if (!entry.restoreId) continue;
			if (deduped.some(existing => existing.restoreId === entry.restoreId)) continue;
			deduped.push(entry);
		}
		if (deduped.length === 0) return deduped;
		let inputs: PactlSinkInput[];
		try {
			inputs = await this.loadSinkInputs();
		} catch {
			return deduped;
		}
		const pending: DuckingStream[] = [];
		for (const entry of deduped) {
			if (await this.repairEntry(entry, inputs)) pending.push(entry);
		}
		return pending;
	}

	// 返回 true 表示条目仍需保留：应用当前没有活跃流，等它下次出声时再修复
	private async repairEntry(entry: DuckingStream, inputs: PactlSinkInput[]) {
		if (!entry.restoreId) return false;
		const sameApp = inputs.filter(input => input.properties?.['module-stream-restore.id'] === entry.restoreId);
		if (sameApp.length === 0) return true;
		const leaked = sameApp.filter(input => this.sameVolumes(this.streamVolumes(input), entry.duckedVolumes, DUCKED_VOLUME_MATCH_TOLERANCE));
		if (leaked.length === 0) return false;
		let repaired = true;
		for (const input of leaked) {
			try {
				await this.applyStreamVolumes({ ...entry, index: input.index }, entry.originalVolumes);
			} catch {
				repaired = false;
			}
		}
		return !repaired;
	}

	private async loadJournal(paths: VoiceBriefPaths) {
		try {
			return checkValue(DuckingJournalSchema, JSON.parse(await fs.readFile(this.journalFile(paths), 'utf-8')));
		} catch (error) {
			if (hasErrorCode(error, 'ENOENT')) return undefined;
			return undefined;
		}
	}

	private async writeJournal(paths: VoiceBriefPaths, journal: DuckingJournal) {
		await fs.writeFile(this.journalFile(paths), JSON.stringify(journal), 'utf-8');
	}

	private async removeJournal(paths: VoiceBriefPaths) {
		await fs.rm(this.journalFile(paths), { force: true });
	}

	private journalFile(paths: VoiceBriefPaths) {
		return path.join(paths.stateDir, 'ducking-session.json');
	}

	private streamVolumes(input: PactlSinkInput) {
		return Object.values(input.volume).map(channel => channel.value);
	}

	private isDuckingExcluded(input: PactlSinkInput) {
		const applicationName = input.properties?.['application.name'];
		// voice-brief 自己的播放流不参与压低：多 daemon 并存时互相压低会让两边都听不清
		return applicationName === VOICE_BRIEF_PLAYER_APPLICATION_NAME || applicationName === CINNAMON_SMOKE_APPLICATION_NAME;
	}

	private sameVolumes(left: number[], right: number[], relativeTolerance = 0) {
		return left.length === right.length && left.every((volume, index) => {
			const expected = right[index];
			if (relativeTolerance === 0) return volume === expected;
			return Math.abs(volume - expected) <= Math.max(1, Math.abs(expected) * relativeTolerance);
		});
	}

}

import createPlayer from 'play-sound';
import type { ChildProcess } from 'node:child_process';
import type { VoiceBriefConfig } from '../../config/schema';
import type { VoiceBriefPaths } from '../../config/types';
import { VOICE_BRIEF_PLAYER_APPLICATION_NAME } from '../types';
import type { PlayerCheckResult } from '../types';
import type { VoiceBriefRuntimeModule } from '../index';

interface PlaybackPlayer {
	player?: string;
	play(audioFile: string, options: PlaybackOptions, callback: (error?: Error) => void): ChildProcess;
}

interface PlaybackPlayerFactory {
	(options?: { player?: string; players?: string[] }): PlaybackPlayer;
}

type PlaybackOptions = Record<string, boolean | string[] | NodeJS.ProcessEnv> & {
	detached: boolean;
};

const createPlaybackPlayer = createPlayer as unknown as PlaybackPlayerFactory;

export class VoiceBriefPlaybackStoppedError extends Error {
	constructor() {
		super('voice-brief playback stopped');
	}
}

export class VoiceBriefPlaybackService {
	private readonly $autoPlayerCommands = ['mpv', 'ffplay', 'mpg123', 'mpg321', 'afplay', 'play', 'aplay', 'mplayer', 'omxplayer', 'cmdmp3', 'cvlc', 'powershell'] as const;
	private $activePlayback?: Promise<void>;
	private $stopActive?: () => void;
	private $stopping = false;

	constructor(readonly module: VoiceBriefRuntimeModule) {}

	async playAudioFile(paths: VoiceBriefPaths, config: VoiceBriefConfig, audioFile: string, volume: number | undefined, onStarted: () => Promise<void>) {
		if (this.$stopping) throw new VoiceBriefPlaybackStoppedError();
		const playerConfig = this.resolvePlayerConfig(config);
		if (playerConfig.disabled) return;
		if (!playerConfig.player.player) throw new Error('找不到可用播放器，请安装 play-sound 支持的播放器，或在 VOICE_BRIEF_PLAYER_COMMAND 中指定播放器');
		const args = playerConfig.auto ? [...playerConfig.args, ...this.volumeArgsFor(playerConfig.player.player, volume)] : playerConfig.args;
		const playback = this.module.duckingService.playWithDucking(paths, config, async () => {
			if (this.$stopping) throw new VoiceBriefPlaybackStoppedError();
			await this.playWithPlayer(audioFile, playerConfig.player, args, onStarted);
		});
		this.$activePlayback = playback;
		try {
			await playback;
		} finally {
			if (this.$activePlayback === playback) this.$activePlayback = undefined;
		}
	}

	async stop() {
		this.$stopping = true;
		this.$stopActive?.();
		try {
			await this.$activePlayback;
		} catch {}
	}

	isDisabled(config: VoiceBriefConfig) {
		return this.resolvePlayerConfig(config).disabled;
	}

	check(config: VoiceBriefConfig): PlayerCheckResult {
		const playerConfig = this.resolvePlayerConfig(config);
		if (playerConfig.disabled) {
			return {
				ok: true,
				command: 'none',
				message: '播放器已关闭，适合测试环境',
			};
		}

		const player = this.playerName(playerConfig.player.player);
		if (!player) {
			return {
				ok: false,
				message: '未找到 play-sound 可用播放器，或设置 VOICE_BRIEF_PLAYER_COMMAND',
			};
		}
		return {
			ok: true,
			command: [player, ...playerConfig.args].join(' '),
			message: `播放器可用: ${[player, ...playerConfig.args].join(' ')}`,
		};
	}

	private resolvePlayerConfig(config: VoiceBriefConfig) {
		const configured = process.env['VOICE_BRIEF_PLAYER_COMMAND'] || config.playback.command;
		if (configured === 'none') {
			return {
				disabled: true,
				args: [] as string[],
			};
		}
		if (configured && configured !== 'auto') {
			const command = this.splitCommand(configured);
			const player = command[0];
			if (!player) throw new Error('播放器命令为空');
			return {
				disabled: false,
				auto: false,
				args: command.slice(1),
				player: this.createPlayer({ player }),
			};
		}

		const player = this.createPlayer({ players: [...this.$autoPlayerCommands] });
		const playerName = this.playerName(player.player);
		return {
			disabled: false,
			auto: true,
			args: this.defaultArgsFor(playerName),
			player,
		};
	}

	private volumeArgsFor(playerName: string | undefined, volume: number | undefined): string[] {
		if (!playerName || volume === undefined || volume === 1) return [];
		const percent = Math.round(volume * 100);
		switch (playerName) {
			case 'mpv':
				return [`--volume=${percent}`];
			case 'ffplay':
				return ['-volume', String(Math.min(percent, 100))];
			case 'mpg123':
			case 'mpg321':
				return ['-g', String(Math.min(percent, 100))];
			case 'mplayer':
				return ['-volume', String(percent)];
			case 'afplay':
			case 'play':
				return ['-v', String(volume)];
			case 'cvlc':
				return ['--gain', String(volume)];
			default:
				return [];
		}
	}

	private splitCommand(command: string) {
		return command.split(/\s+/).filter(Boolean);
	}

	private defaultArgsFor(player?: string) {
		// --audio-client-name 把 voice-brief 播放流标记进 application.name，
		// ducking 以此跳过自己的流（mpv 不受 PULSE_PROP 环境变量影响）
		if (player === 'mpv') return ['--no-video', '--really-quiet', `--audio-client-name=${VOICE_BRIEF_PLAYER_APPLICATION_NAME}`];
		if (player === 'ffplay') return ['-nodisp', '-autoexit', '-loglevel', 'quiet'];
		return [];
	}

	private createPlayer(options?: { player?: string; players?: string[] }) {
		return createPlaybackPlayer(options);
	}

	private async playWithPlayer(audioFile: string, player: PlaybackPlayer, args: string[], onStarted: () => Promise<void>) {
		const playerName = this.playerName(player.player);
		if (!playerName) throw new Error('播放器命令为空');
		const options = {
			detached: false,
			// mpv 会覆盖 application.name，仅靠环境变量标记不了它；
			// 对不自带命名的播放器该环境变量仍能生效
			env: {
				...process.env,
				'PULSE_PROP_application.name': VOICE_BRIEF_PLAYER_APPLICATION_NAME,
			},
			[playerName]: args,
		};

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let started = false;
			let startedPromise = Promise.resolve();
			const start = () => {
				if (started || settled) return;
				started = true;
				startedPromise = onStarted();
			};
			const finish = (error?: Error) => {
				if (settled) return;
				if (!error) start();
				settled = true;
				void startedPromise.then(() => {
					if (error) reject(error);
					else resolve();
				}, reject);
			};
			const child = player.play(audioFile, options, error => finish(error));
			this.$stopActive = () => {
				try {
					child.kill();
				} finally {
					finish(new VoiceBriefPlaybackStoppedError());
				}
			};
			child.once('spawn', start);
			child.on('error', finish);
		}).finally(() => {
			this.$stopActive = undefined;
		});
	}

	private playerName(value?: string) {
		if (!value) return undefined;
		return value;
	}
}

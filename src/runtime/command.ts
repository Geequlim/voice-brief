import { action, command, Command, type CliActionSchema, type CliContext, type CliOutput } from '../infrastructure/cli';
import { Type } from '@sinclair/typebox';
import type { ProgressPriority } from './types';
import type { VoiceBriefRuntimeModule } from './index';

const JsonOption = {
	flags: '--json',
	schema: Type.Optional(Type.Boolean({ description: '以 JSON 输出' })),
} as const;

class VoiceBriefRuntimeCommand extends Command {
	declare readonly module: VoiceBriefRuntimeModule;

	protected textArg(args: string[] | undefined) {
		return (args || []).join(' ');
	}

	protected progressPriority(priority?: string, high?: boolean): ProgressPriority {
		if (high || priority === 'high') return 'high';
		return 'normal';
	}

}

@command('speak', {
	description: '播放最终回复前的语音简报',
	summary: '播放最终语音简报',
})
export class VoiceBriefSpeakCommand extends VoiceBriefRuntimeCommand {
	static readonly SpeakActionSchema = {
		args: [
			{ name: 'text', schema: Type.Optional(Type.Array(Type.String(), { description: '要播报的文本' })), variadic: true },
		],
		options: {
			agent: { flags: '-a, --agent <agent>', schema: Type.Optional(Type.String({ description: '播报来源 agent 标识' })) },
			progress: { flags: '-P, --progress', schema: Type.Optional(Type.Boolean({ description: '按进度提示处理，启用 80 字截断和节流' })) },
			model: { flags: '-m, --model <model>', schema: Type.Optional(Type.String({ description: '播报来源模型标识' })) },
			priority: { flags: '--priority <priority>', schema: Type.Optional(Type.String({ description: '进度优先级: normal 或 high' })) },
			high: { flags: '-H, --high', schema: Type.Optional(Type.Boolean({ description: '等价于 --priority high' })) },
			persona: { flags: '-p, --persona <persona>', schema: Type.Optional(Type.String({ description: '临时指定人设文件名，可省略 .md' })) },
			session: { flags: '-s, --session <session>', schema: Type.Optional(Type.String({ description: '播报所属会话标识' })) },
		},
		summary: '播放最终语音简报',
	} as const satisfies CliActionSchema;

	@action('', VoiceBriefSpeakCommand.SpeakActionSchema)
	async speak(ctx: CliContext<typeof VoiceBriefSpeakCommand.SpeakActionSchema>, output: CliOutput) {
		const kind = ctx.options.progress ? 'progress' : 'final';
		const priority = this.progressPriority(ctx.options.priority, ctx.options.high);
		const result = await this.module.daemonClientService.submit({
			kind,
			text: this.textArg(ctx.args.text),
			options: {
				agent: ctx.options.agent,
				model: ctx.options.model,
				personaName: ctx.options.persona,
				priority,
				session: ctx.options.session,
			},
		});
		if (result.status === 'cached') output.line(`[voice-brief] cache hit via ${result.provider}`);
		if (result.status === 'synthesizing') output.line(`[voice-brief] synthesis started via ${result.provider}`);
		if ((result.status === 'cached' || result.status === 'synthesizing') && result.warning) {
			ctx.stderr.write(`[voice-brief] warning: ${result.warning}\n`);
		}
		if (result.status === 'skipped') output.line(`[voice-brief] request skipped: ${result.reason}`);
		if (result.status === 'rejected') {
			output.line(`[voice-brief] request rejected: ${result.reason}`);
			return 1;
		}
		return 0;
	}
}

@command('doctor', {
	description: '检查配置、provider 和播放器状态',
	summary: '检查运行环境',
})
export class VoiceBriefDoctorCommand extends VoiceBriefRuntimeCommand {
	static readonly DoctorActionSchema = {
		options: {
			json: JsonOption,
		},
		summary: '检查运行环境',
	} as const satisfies CliActionSchema;

	@action('', VoiceBriefDoctorCommand.DoctorActionSchema)
	async doctor(ctx: CliContext<typeof VoiceBriefDoctorCommand.DoctorActionSchema>, output: CliOutput) {
		const report = await this.module.runtimeService.runDoctor();
		if (ctx.options.json) {
			output.json(report);
			return 0;
		}
		output.line(`Config: ${report.paths.configFile}`);
		output.line(report.player.message);
		output.line(report.ducking.message);
		if (report.state.lastPlaybackError) output.line(`最近一次后台播放失败: ${report.state.lastPlaybackError}`);
		for (const provider of report.providers) {
			output.line(`${provider.id}: ${provider.message}`);
		}
		return report.player.ok ? 0 : 1;
	}
}

@command('provider', {
	description: '查看 TTS provider',
	summary: '查看 provider',
})
export class VoiceBriefProviderCommand extends VoiceBriefRuntimeCommand {
	static readonly ProviderListActionSchema = {
		summary: '列出 provider',
	} as const satisfies CliActionSchema;

	@action('list', VoiceBriefProviderCommand.ProviderListActionSchema)
	async list(_ctx: CliContext<typeof VoiceBriefProviderCommand.ProviderListActionSchema>, output: CliOutput) {
		for (const provider of this.module.providerService.listProviderIds()) {
			output.line(provider);
		}
		return 0;
	}
}

@command('runtime', {
	description: '调整 daemon 运行配置',
	summary: '调整 daemon 运行配置',
})
export class VoiceBriefRuntimeConfigCommand extends VoiceBriefRuntimeCommand {
	static readonly ConfigureActionSchema = {
		options: {
			playbackStartDelayMs: {
				flags: '--playback-start-delay-ms <milliseconds>',
				schema: Type.Number({ minimum: 0, description: '播放器启动延迟毫秒数' }),
			},
		},
		summary: '调整 daemon 运行配置',
	} as const satisfies CliActionSchema;

	@action('configure', VoiceBriefRuntimeConfigCommand.ConfigureActionSchema)
	async configure(ctx: CliContext<typeof VoiceBriefRuntimeConfigCommand.ConfigureActionSchema>, output: CliOutput) {
		const config = await this.module.daemonClientService.configureRuntime({
			playbackStartDelayMs: ctx.options.playbackStartDelayMs,
		});
		output.line(`[voice-brief] playback start delay set to ${config.playbackStartDelayMs}ms`);
		return 0;
	}
}

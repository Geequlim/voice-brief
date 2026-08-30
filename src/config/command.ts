import { action, command, Command, type CliActionSchema, type CliContext, type CliOutput } from '../infrastructure/cli';
import { Type } from '@sinclair/typebox';
import type { VoiceBriefConfigModule } from './index';
import type { VoiceBriefConfig } from './schema';

interface VoiceBriefPersonaInitModule {
	personaService: {
		ensureBundledPersonas(force?: boolean): Promise<void>;
	};
}

const JsonOption = {
	flags: '--json',
	schema: Type.Optional(Type.Boolean({ description: '以 JSON 输出' })),
} as const;

const ForceOption = {
	flags: '-f, --force',
	schema: Type.Optional(Type.Boolean({ description: '覆盖已存在的配置文件和内置人设' })),
} as const;

class VoiceBriefConfigCommand extends Command {
	declare readonly module: VoiceBriefConfigModule;

	protected printConfig(output: CliOutput, config: Pick<VoiceBriefConfig, 'enabled'>) {
		output.line(`Voice brief: ${config.enabled ? 'on' : 'off'}`);
	}
}

@command('status', {
	description: '查看 voice-brief 当前状态',
	summary: '查看状态',
})
export class VoiceBriefStatusCommand extends VoiceBriefConfigCommand {
	static readonly StatusActionSchema = {
		options: {
			json: JsonOption,
		},
		summary: '查看状态',
	} as const satisfies CliActionSchema;

	@action('', VoiceBriefStatusCommand.StatusActionSchema)
	async status(ctx: CliContext<typeof VoiceBriefStatusCommand.StatusActionSchema>, output: CliOutput) {
		const paths = await this.module.pathService.resolveVoiceBriefPaths();
		const config = await this.module.configService.ensure();
		const state = await this.module.stateService.load();
		if (ctx.options.json) {
			output.json({ paths, config, state });
			return 0;
		}
		this.printConfig(output, config);
		output.line(`Provider: ${config.provider}`);
		if (config.fallbackProvider) output.line(`Fallback provider: ${config.fallbackProvider}`);
		output.line(`Config: ${paths.configFile}`);
		output.line(`Personas: ${paths.personaDir}`);
		output.line(`State: ${paths.stateFile}`);
		return 0;
	}
}

@command('init', {
	description: '初始化 voice-brief 配置和内置人设',
	summary: '初始化配置',
})
export class VoiceBriefInitCommand extends VoiceBriefConfigCommand {
	static readonly InitActionSchema = {
		options: {
			force: ForceOption,
		},
		summary: '初始化配置',
	} as const satisfies CliActionSchema;

	@action('', VoiceBriefInitCommand.InitActionSchema)
	async init(ctx: CliContext<typeof VoiceBriefInitCommand.InitActionSchema>, output: CliOutput) {
		const { paths } = await this.module.configService.init(ctx.options.force);
		const personaModule = this.module.app.getModule('VoiceBriefPersonaModule') as VoiceBriefPersonaInitModule | undefined;
		await personaModule?.personaService.ensureBundledPersonas(ctx.options.force);
		output.line(`Config: ${paths.configFile}`);
		return 0;
	}
}

@command('on', {
	description: '开启语音简报',
	summary: '开启语音简报',
})
export class VoiceBriefOnCommand extends VoiceBriefConfigCommand {
	static readonly OnActionSchema = {
		summary: '开启语音简报',
	} as const satisfies CliActionSchema;

	@action('', VoiceBriefOnCommand.OnActionSchema)
	async enable(_ctx: CliContext<typeof VoiceBriefOnCommand.OnActionSchema>, output: CliOutput) {
		const config = await this.module.configService.setEnabled(true);
		this.printConfig(output, config);
		return 0;
	}
}

@command('off', {
	description: '关闭语音简报',
	summary: '关闭语音简报',
})
export class VoiceBriefOffCommand extends VoiceBriefConfigCommand {
	static readonly OffActionSchema = {
		summary: '关闭语音简报',
	} as const satisfies CliActionSchema;

	@action('', VoiceBriefOffCommand.OffActionSchema)
	async disable(_ctx: CliContext<typeof VoiceBriefOffCommand.OffActionSchema>, output: CliOutput) {
		const config = await this.module.configService.setEnabled(false);
		this.printConfig(output, config);
		return 0;
	}
}

@command('toggle', {
	description: '切换语音简报开关',
	summary: '切换语音简报',
})
export class VoiceBriefToggleCommand extends VoiceBriefConfigCommand {
	static readonly ToggleActionSchema = {
		summary: '切换语音简报',
	} as const satisfies CliActionSchema;

	@action('', VoiceBriefToggleCommand.ToggleActionSchema)
	async toggle(_ctx: CliContext<typeof VoiceBriefToggleCommand.ToggleActionSchema>, output: CliOutput) {
		const current = await this.module.configService.ensure();
		const config = await this.module.configService.setEnabled(!current.enabled);
		this.printConfig(output, config);
		return 0;
	}
}

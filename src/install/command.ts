import { action, command, Command, type CliActionSchema, type CliContext, type CliOutput } from '../infrastructure/cli';
import { Type } from '@sinclair/typebox';
import type { InstallPlan, InstallTarget, InstallVerboseValue } from './types';
import type { VoiceBriefInstallModule } from './index';

const DryRunOption = {
	flags: '--dry-run',
	schema: Type.Optional(Type.Boolean({ description: '只输出将要修改的文件，不写入磁盘' })),
} as const;

class VoiceBriefInstallCommand extends Command {
	declare readonly module: VoiceBriefInstallModule;

	protected installTarget(value: string): InstallTarget {
		return this.module.installService.parseInstallTarget(value);
	}

	protected verbose(value: InstallVerboseValue | undefined) {
		return this.module.installService.parseVerboseValue(value);
	}

	protected printInstallPlan(output: CliOutput, plan: InstallPlan) {
		const persona = plan.persona ? ` ${plan.persona}` : '';
		const verbose = plan.verbose === undefined ? '' : ` verbose=${plan.verbose ? 'on' : 'off'}`;
		output.line(`${plan.action}:${persona} -> ${plan.target}${verbose}${plan.dryRun ? ' (dry-run)' : ''}`);
		for (const file of plan.files) {
			output.line(`  ${file}`);
		}
		for (const message of plan.messages) {
			output.line(message);
		}
	}
}

@command('install', {
	description: '安装 agent 全局提示词支持',
	summary: '安装 agent 支持',
})
export class VoiceBriefInstallCommandGroup extends VoiceBriefInstallCommand {
	static readonly InstallActionSchema = {
		args: [
			{ name: 'persona', schema: Type.String({ description: '人设文件名，可省略 .md' }) },
			{ name: 'target', schema: Type.String({ description: 'codex、claude、opencode、copilot、pi、kimi-code 或 zcode' }) },
		],
		options: {
			dryRun: DryRunOption,
			verbose: {
				flags: '--verbose <enabled>',
				schema: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false'), Type.Literal('on'), Type.Literal('off'), Type.Null()], { description: '是否开启过程播报: true、false、on 或 off' })),
			},
		},
		summary: '安装 agent 支持',
	} as const satisfies CliActionSchema;

	@action('', VoiceBriefInstallCommandGroup.InstallActionSchema)
	async install(ctx: CliContext<typeof VoiceBriefInstallCommandGroup.InstallActionSchema>, output: CliOutput) {
		const plan = await this.module.installService.install(ctx.args.persona, this.installTarget(ctx.args.target), {
			dryRun: ctx.options.dryRun,
			verbose: this.verbose(ctx.options.verbose),
		});
		this.printInstallPlan(output, plan);
		return 0;
	}
}

@command('uninstall', {
	description: '移除 agent 全局提示词支持',
	summary: '卸载 agent 支持',
})
export class VoiceBriefUninstallCommandGroup extends VoiceBriefInstallCommand {
	static readonly UninstallActionSchema = {
		args: [
			{ name: 'target', schema: Type.String({ description: 'codex、claude、opencode、copilot、pi、kimi-code 或 zcode' }) },
		],
		options: {
			dryRun: DryRunOption,
		},
		summary: '卸载 agent 支持',
	} as const satisfies CliActionSchema;

	@action('', VoiceBriefUninstallCommandGroup.UninstallActionSchema)
	async uninstall(ctx: CliContext<typeof VoiceBriefUninstallCommandGroup.UninstallActionSchema>, output: CliOutput) {
		const plan = await this.module.installService.uninstall(this.installTarget(ctx.args.target), {
			dryRun: ctx.options.dryRun,
		});
		this.printInstallPlan(output, plan);
		return 0;
	}
}

import { action, command, Command, type CliActionSchema, type CliContext, type CliOutput } from '../infrastructure/cli';
import { Type } from '@sinclair/typebox';
import type { VoiceBriefPersonaModule } from './index';

@command('persona', {
	description: '管理 markdown 人设文件',
	summary: '管理人设',
})
export class VoiceBriefPersonaCommand extends Command {
	declare readonly module: VoiceBriefPersonaModule;

	static readonly PersonaListActionSchema = {
		summary: '列出人设',
	} as const satisfies CliActionSchema;

	static readonly PersonaShowActionSchema = {
		args: [
			{ name: 'name', schema: Type.String({ description: '人设文件名，可省略 .md' }) },
		],
		summary: '查看人设',
	} as const satisfies CliActionSchema;

	@action('list', VoiceBriefPersonaCommand.PersonaListActionSchema)
	async list(_ctx: CliContext<typeof VoiceBriefPersonaCommand.PersonaListActionSchema>, output: CliOutput) {
		const personas = await this.module.personaService.list();
		for (const persona of personas) {
			output.line(persona);
		}
		return 0;
	}

	@action('show', VoiceBriefPersonaCommand.PersonaShowActionSchema)
	async show(ctx: CliContext<typeof VoiceBriefPersonaCommand.PersonaShowActionSchema>, output: CliOutput) {
		const markdown = await this.module.personaService.readMarkdown(ctx.args.name);
		output.write(markdown);
		return 0;
	}
}

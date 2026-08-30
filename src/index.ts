import { VoiceBriefConfigModule } from './config';
import { VoiceBriefHookModule } from './hook';
import { isCurrentMainModule } from './infrastructure/entry';
import { createCli } from './infrastructure/cli';
import options from './configs.static.yaml';
import { VoiceBriefInstallModule } from './install';
import { VoiceBriefPersonaModule } from './persona';
import { VoiceBriefRuntimeModule } from './runtime';
import { VOICE_BRIEF_DAEMON_ARGUMENT } from './runtime/types';

export const modules = {
	VoiceBriefConfigModule,
	VoiceBriefPersonaModule,
	VoiceBriefHookModule,
	VoiceBriefRuntimeModule,
	VoiceBriefInstallModule,
};

export function createApp() {
	return createCli(modules, options);
}

export async function main() {
	const app = createApp();
	if (process.argv[2] === VOICE_BRIEF_DAEMON_ARGUMENT) {
		const daemonService = app.getModule(VoiceBriefRuntimeModule).daemonService;
		if (await daemonService.start(true)) {
			process.once('SIGINT', () => void daemonService.stop());
			process.once('SIGTERM', () => void daemonService.stop());
		}
		return;
	}
	return app.start();
}

export type App = ReturnType<typeof createApp>;
export const cliNodeApp = isCurrentMainModule() ? main() : undefined;

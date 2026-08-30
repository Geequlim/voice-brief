export type InstallTarget = 'codex' | 'claude' | 'opencode' | 'copilot' | 'pi' | 'kimi-code' | 'zcode';
export type InstallVerboseValue = 'true' | 'false' | 'on' | 'off';

export interface InstallOptions {
	dryRun?: boolean;
	verbose?: boolean;
}

export interface InstallPlan {
	action: 'install' | 'uninstall';
	dryRun: boolean;
	persona?: string;
	verbose?: boolean;
	target: InstallTarget;
	files: string[];
	messages: string[];
}

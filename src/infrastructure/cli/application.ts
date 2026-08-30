import type { Module, ModuleClass } from '../module';
import { VoiceBriefApp } from '../module';
import type { Command, CommandClass } from './command';
import { runCommanderCli } from './commander';

export interface CliApplicationOptions {
	/** 应用名，作为 CLI 程序名展示 */
	name?: string;
	/** 默认启动命令 */
	command?: string;
}

/**
 * CLI 应用：持有模块注册表，收集各模块贡献的命令并交给 Commander 执行。
 * 持有模块注册表并收集各模块贡献的命令。
 */
export class CliApplication extends VoiceBriefApp {
	declare readonly options: CliApplicationOptions;

	private $argv: string[] = [];
	private $exitCode = 0;
	private $commands: Command[] | undefined;

	constructor(types: readonly ModuleClass[], options: CliApplicationOptions = {}) {
		super();
		this.options = options;
		for (const type of types) {
			this.register(new type(this));
		}
	}

	get name() { return this.options.name || 'voice-brief'; }
	get argv() { return this.$argv; }
	get exitCode() { return this.$exitCode; }

	get commands(): Command[] {
		if (this.$commands) return this.$commands;
		const commands: Command[] = [];
		for (const module of this.modules) {
			const constructor = module.constructor as ModuleClass & { commands?: readonly CommandClass[] };
			for (const commandClass of constructor.commands || []) {
				const command = new commandClass(module as Module);
				if (command.enabled) commands.push(command);
			}
		}
		this.$commands = commands;
		return commands;
	}

	protected get defaultCommandParts() {
		const command = this.options.command?.trim();
		if (!command) return [];
		return command.split(/\s+/).filter(Boolean);
	}

	protected normalizeCliArgv(argv: string[]) {
		const args = argv.filter(Boolean);
		const defaultCommand = this.defaultCommandParts;
		if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h' || args[0] === '--version' || args[0] === '-V') {
			return args;
		}
		if (args.length === 0) {
			return defaultCommand;
		}
		if (args[0].startsWith('-') && defaultCommand.length > 0) {
			return [...defaultCommand, ...args];
		}
		return args;
	}

	async runCli(argv: string[] = this.argv) {
		return runCommanderCli(this, argv);
	}

	async start(argv: string[] = process.argv.slice(2)) {
		this.$argv = this.normalizeCliArgv(argv);
		for (const command of this.commands) {
			await command.setup();
		}
		this.$exitCode = (await this.runCli(this.$argv)) || 0;
		process.exit(this.$exitCode);
	}
}

export function createCli(moduleClasses: Record<string, ModuleClass> | readonly ModuleClass[], options: CliApplicationOptions = {}) {
	const types = Array.isArray(moduleClasses) ? moduleClasses : Object.values(moduleClasses);
	return new CliApplication(types, options);
}

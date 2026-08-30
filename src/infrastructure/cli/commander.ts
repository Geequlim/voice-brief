import type { TSchema } from '@sinclair/typebox';
import { OptionalKind } from '@sinclair/typebox';
import { Command as CommanderCommand, CommanderError, Option } from 'commander';
import type { CliApplication } from './application';
import { type Command, getCliSchemaMeta, parseCliScalarValue } from './command';
import type { CliActionDefinition, CliContext, CliOptionDefinition, CliOutput } from './types';
import { parseValue } from '../schema';

function parseCliFlags(flags: string) {
	return flags.split(/[,\s]+/).filter(flag => flag.startsWith('-'));
}

function validateCliValue(schema: TSchema, value: unknown, label: string) {
	if (value === undefined && (schema as TSchema & { [OptionalKind]?: string })[OptionalKind] === 'Optional') {
		return undefined;
	}
	try {
		return parseValue(schema, value);
	} catch (error) {
		if (error instanceof Error) {
			error.message = `${label}: ${error.message}`;
		}
		throw error;
	}
}

function registerArgument(commanderCommand: CommanderCommand, action: CliActionDefinition) {
	const args = action.schema.args || [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg) {
			continue;
		}

		const { name, schema } = arg;
		if (arg.variadic && index !== args.length - 1) {
			throw new Error(`参数 ${name} 只能作为最后一个位置参数声明为 variadic`);
		}

		const meta = getCliSchemaMeta(schema);
		const suffix = arg.variadic ? '...' : '';
		const token = meta.required ? `<${name}${suffix}>` : `[${name}${suffix}]`;
		const parser = arg.variadic
			? (raw: string, previous: string[] | undefined) => [...(previous || []), raw]
			: (raw: string) => parseCliScalarValue(schema, raw);
		commanderCommand.argument(
			token,
			meta.description,
			parser,
			arg.variadic ? undefined : meta.defaultValue,
		);
	}
}

function registerCliOption(commanderCommand: CommanderCommand, optionDefinition: CliOptionDefinition) {
	const meta = getCliSchemaMeta(optionDefinition.schema);
	const flag = optionDefinition.flags;
	if (meta.type === 'boolean') {
		if (meta.defaultValue !== undefined) {
			commanderCommand.option(flag, meta.description, meta.defaultValue as boolean | string | string[]);
		} else {
			commanderCommand.option(flag, meta.description);
		}
		return;
	}

	const option = new Option(`${flag} ${meta.required ? '<value>' : '[value]'}`, meta.description);
	if (meta.defaultValue !== undefined) {
		option.default(meta.defaultValue);
	}
	if (meta.enumValues?.length) {
		option.choices(meta.enumValues.map(value => `${value}`));
	}
	option.argParser((raw: string, previous: unknown) => parseCliOptionValue(optionDefinition.schema, raw, previous));
	commanderCommand.addOption(option);
}

function parseCliOptionValue(schema: TSchema, raw: string, previous: unknown) {
	const meta = getCliSchemaMeta(schema);
	if (meta.type !== 'array') return parseCliScalarValue(schema, raw);

	const itemSchema = (schema as TSchema & { items?: TSchema }).items;
	const parsed = itemSchema ? parseCliScalarValue(itemSchema, raw) : raw;
	const previousValues: unknown[] = Array.isArray(previous) ? previous : [];
	return [...previousValues, parsed];
}

function registerCommandOptions(commanderCommand: CommanderCommand, command: Command) {
	for (const optionDefinition of Object.values(command.options)) {
		registerCliOption(commanderCommand, optionDefinition);
	}
}

function registerActionOptions(commanderCommand: CommanderCommand, action: CliActionDefinition) {
	for (const optionDefinition of Object.values(action.schema.options || {})) {
		registerCliOption(commanderCommand, optionDefinition);
	}
}

function createValidatedOptions(
	labelPrefix: string,
	optionDefinitions: Readonly<Record<string, CliOptionDefinition>>,
	values: Record<string, unknown>,
) {
	const options = {} as Record<string, unknown>;
	for (const [key, optionDefinition] of Object.entries(optionDefinitions)) {
		options[key] = validateCliValue(optionDefinition.schema, values[key], `${labelPrefix} ${optionDefinition.flags}`);
	}
	return options;
}

function createCommandContext(app: CliApplication, command: Command, action: CliActionDefinition, commanderCommand: CommanderCommand): CliContext {
	const args = {} as Record<string, unknown>;
	const argEntries = action.schema.args || [];

	for (let index = 0; index < argEntries.length; index++) {
		const { name, schema } = argEntries[index] || {};
		if (!name || !schema) continue;
		args[name] = validateCliValue(schema, commanderCommand.processedArgs?.[index], `参数 ${name}`);
	}

	const options = createValidatedOptions('选项', { ...command.options, ...action.schema.options }, commanderCommand.opts());

	return {
		args,
		globalOptions: {},
		options,
		argv: app.argv,
		cwd: process.cwd(),
		env: process.env,
		stderr: process.stderr,
		stdin: process.stdin,
		stdout: process.stdout,
	};
}

function assertOptionConflicts(
	ownerLabel: string,
	optionDefinitions: Readonly<Record<string, CliOptionDefinition>>,
	existingLabel: string,
	existingDefinitions: Readonly<Record<string, CliOptionDefinition>>,
) {
	for (const [key, optionDefinition] of Object.entries(optionDefinitions)) {
		if (existingDefinitions[key]) {
			throw new Error(`${ownerLabel} 的选项 key 与${existingLabel}冲突: ${key}`);
		}

		const flags = new Set(parseCliFlags(optionDefinition.flags));
		for (const [, existingDefinition] of Object.entries(existingDefinitions)) {
			for (const flag of parseCliFlags(existingDefinition.flags)) {
				if (flags.has(flag)) {
					throw new Error(`${ownerLabel} 的选项 flags 与${existingLabel}冲突: ${flag}`);
				}
			}
		}
	}
}

function assertActionOptionConflicts(command: Command, action: CliActionDefinition) {
	assertOptionConflicts(`命令 ${command.constructor.name}.${action.handlerKey}`, action.schema.options || {}, `命令 ${command.constructor.name} 共享参数`, command.options);
}

function createCliOutput(): CliOutput {
	return {
		json(value) {
			process.stdout.write(`${JSON.stringify(value)}\n`);
		},
		line(text = '') {
			process.stdout.write(`${text}\n`);
		},
		write(chunk) {
			process.stdout.write(chunk);
		},
	};
}

async function executeAction(app: CliApplication, command: Command, action: CliActionDefinition, commanderCommand: CommanderCommand, onExitCode: (exitCode: number) => void) {
	const handler = command[action.handlerKey as keyof Command] as unknown;
	if (!(handler instanceof Function)) {
		throw new Error(`命令 ${command.constructor.name}.${action.handlerKey} 不存在`);
	}

	const exitCode = await (handler as (this: Command, req: CliContext, output: CliOutput) => Promise<number | void> | number | void).call(
		command,
		createCommandContext(app, command, action, commanderCommand),
		createCliOutput(),
	);
	const normalizedExitCode = exitCode || 0;
	process.exitCode = normalizedExitCode;
	onExitCode(normalizedExitCode);
}

function applyActionMetadata(commanderCommand: CommanderCommand, action: CliActionDefinition) {
	if (action.schema.summary) commanderCommand.summary(action.schema.summary);
	if (action.schema.description) commanderCommand.description(action.schema.description);
	if (action.schema.deprecated) commanderCommand.description(`${action.schema.description || action.schema.summary || ''} [deprecated]`.trim());
	registerArgument(commanderCommand, action);
	registerActionOptions(commanderCommand, action);
	const lastArgument = action.schema.args?.at(-1);
	if (lastArgument?.variadic) {
		commanderCommand.allowUnknownOption();
	}
	if (action.schema.examples?.length) {
		commanderCommand.addHelpText('after', `\nExamples:\n${action.schema.examples.map(item => `  ${item}`).join('\n')}`);
	}
}

function registerAction(commanderCommand: CommanderCommand, app: CliApplication, command: Command, action: CliActionDefinition, onExitCode: (exitCode: number) => void) {
	assertActionOptionConflicts(command, action);
	if (!action.path) {
		applyActionMetadata(commanderCommand, action);
		commanderCommand.action(async function () {
			await executeAction(app, command, action, this, onExitCode);
		});
		return;
	}

	let subCommand = commanderCommand;
	for (const pathSegment of action.path.split('/')) {
		if (!pathSegment) throw new Error(`命令 ${command.constructor.name}.${action.handlerKey} 包含空 action 路径`);
		const existingCommand = subCommand.commands.find(item => item.name() === pathSegment);
		if (existingCommand) {
			subCommand = existingCommand;
			continue;
		}
		subCommand = subCommand.command(pathSegment);
		registerCommandOptions(subCommand, command);
	}
	applyActionMetadata(subCommand, action);
	subCommand.action(async function () {
		await executeAction(app, command, action, this, onExitCode);
	});
}

function registerCommand(program: CommanderCommand, app: CliApplication, command: Command, onExitCode: (exitCode: number) => void) {
	if (!command.prefix) {
		registerCommandOptions(program, command);
		for (const action of command.actions) {
			registerAction(program, app, command, action, onExitCode);
		}
		return;
	}

	const parentCommand = program.command(command.prefix);
	registerCommandOptions(parentCommand, command);
	if (command.summary) parentCommand.summary(command.summary);
	if (command.description) parentCommand.description(command.description);

	for (const action of command.actions) {
		registerAction(parentCommand, app, command, action, onExitCode);
	}
}

export async function runCommanderCli(app: CliApplication, argv: string[]): Promise<number> {
	const program = new CommanderCommand(app.name);
	let actionExitCode: number | undefined;
	program.showHelpAfterError();
	program.helpCommand(true);
	program.exitOverride();
	program.version(VERSION.name, '-V, --version');

	for (const command of app.commands) {
		if (!command.enabled) continue;
		registerCommand(program, app, command, exitCode => {
			actionExitCode = exitCode;
		});
	}

	try {
		await program.parseAsync(argv, { from: 'user' });
		return actionExitCode ?? app.exitCode;
	} catch (error) {
		if (error instanceof CommanderError) {
			process.exitCode = error.exitCode;
			return error.exitCode;
		}
		throw error;
	}
}

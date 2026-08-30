import type { Static, TSchema } from '@sinclair/typebox';

export interface CliArgumentDefinition<TSchemaType extends TSchema = TSchema> {
	name: string;
	schema: TSchemaType;
	variadic?: boolean;
}

export interface CliOptionDefinition<TSchemaType extends TSchema = TSchema> {
	flags: string;
	schema: TSchemaType;
}

export interface CliActionSchema {
	args?: readonly CliArgumentDefinition[];
	options?: Readonly<Record<string, CliOptionDefinition>>;
	summary?: string;
	description?: string;
	examples?: string[];
	deprecated?: boolean;
	hidden?: boolean;
}

export interface ICommandOptions {
	summary?: string;
	description?: string;
	deprecated?: boolean;
	hidden?: boolean;
}

type CliInferArgs<T extends readonly CliArgumentDefinition[] | undefined> =
	T extends readonly CliArgumentDefinition[]
		? { [K in T[number] as K['name']]: Static<K['schema']> }
		: Record<string, never>;

type CliInferOptions<T extends Readonly<Record<string, CliOptionDefinition>> | undefined> =
	[NonNullable<T>] extends [Readonly<Record<string, CliOptionDefinition>>]
		? { [K in keyof NonNullable<T>]: Static<NonNullable<T>[K]['schema']> }
		: Record<string, never>;

type CliInferMergedOptions<
	TShared extends Readonly<Record<string, CliOptionDefinition>> | undefined,
	TAction extends Readonly<Record<string, CliOptionDefinition>> | undefined,
> = CliInferOptions<TShared> & CliInferOptions<TAction>;

export interface CliContext<
	T extends CliActionSchema = CliActionSchema,
	TSharedOptions extends Readonly<Record<string, CliOptionDefinition>> | undefined = undefined,
> {
	args: CliInferArgs<T['args']>;
	globalOptions: Record<string, unknown>;
	options: CliInferMergedOptions<TSharedOptions, T['options']>;
	argv: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	stdin: NodeJS.ReadStream;
	stdout: NodeJS.WriteStream;
	stderr: NodeJS.WriteStream;
}

export interface CliOutput {
	json(value: unknown): void;
	line(text?: string): void;
	write(chunk: string | Uint8Array): void;
}

export interface CliSchemaMeta {
	defaultValue?: unknown;
	description?: string;
	enumValues?: unknown[];
	examples?: unknown[];
	maxLength?: number;
	maximum?: number;
	minLength?: number;
	minimum?: number;
	required: boolean;
	type?: string;
}

export type CliActionHandler<TReq extends CliContext = CliContext> = ((req: TReq, output: CliOutput) => Promise<number | void> | number | void) & {
	$actionDefinition?: {
		path: string;
		schema: CliActionSchema;
	};
};

export interface CliActionDefinition<T extends CliActionSchema = CliActionSchema> {
	path: string;
	schema: T;
	handler: CliActionHandler<CliContext<T>>;
	handlerKey: string;
}

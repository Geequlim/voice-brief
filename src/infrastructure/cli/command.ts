import type { TSchema } from '@sinclair/typebox';
import { OptionalKind } from '@sinclair/typebox';
import type { Module, ModuleClass } from '../module';
import type { CliActionDefinition, CliActionHandler, CliActionSchema, CliOptionDefinition, CliSchemaMeta, ICommandOptions } from './types';

export type CommandClass = (new (module: Module) => Command) & { $actions?: CliActionDefinition[] };

export class Command {
	declare private $prefix: string;
	declare private $summary?: string;
	declare private $description?: string;
	declare private $deprecated?: boolean;
	declare private $hidden?: boolean;

	/** 动作列表 */
	get actions(): CliActionDefinition[] {
		const prototype = Object.getPrototypeOf(this) as { constructor: CommandClass };
		const constructor = prototype.constructor;
		return constructor.$actions || [];
	}

	get prefix(): string { return this.$prefix; }
	get summary(): string | undefined { return this.$summary; }
	get description(): string | undefined { return this.$description; }
	get deprecated(): boolean | undefined { return this.$deprecated; }
	get hidden(): boolean | undefined { return this.$hidden; }
	get options(): Readonly<Record<string, CliOptionDefinition>> { return {}; }
	get enabled() { return true; }

	constructor(readonly module: Module) {}

	get app() { return this.module.app; }
	get name() { return this.constructor.name; }

	getModule<T extends ModuleClass>(target: T): InstanceType<T> {
		return this.module.app.getModule(target);
	}

	async setup() {}
	async initialize() {}
	async finalize() {}
}

/**
 * 定义命令组
 * @param prefix 父命令路径
 */
export function command<T extends Command>(prefix = '', options?: ICommandOptions) {
	return function (target: new (module: never) => T) {
		Object.defineProperty(target.prototype, '$prefix', { value: prefix.trim(), writable: false, enumerable: false, configurable: false });
		Object.defineProperty(target.prototype, '$summary', { value: options?.summary, writable: false, enumerable: false, configurable: false });
		Object.defineProperty(target.prototype, '$description', { value: options?.description, writable: false, enumerable: false, configurable: false });
		Object.defineProperty(target.prototype, '$deprecated', { value: options?.deprecated, writable: false, enumerable: false, configurable: false });
		Object.defineProperty(target.prototype, '$hidden', { value: options?.hidden, writable: false, enumerable: false, configurable: false });

		let actions: CliActionDefinition[] = [];
		let proto = Object.getPrototypeOf(target) as CommandClass;
		while (proto?.prototype && proto.prototype instanceof Command) {
			if (Array.isArray(proto.$actions) && proto.$actions.length) {
				actions = [...proto.$actions, ...actions];
			}
			proto = Object.getPrototypeOf(proto);
		}

		const props = Object.getOwnPropertyDescriptors(target.prototype);
		for (const key of Object.keys(props)) {
			const handler = props[key]?.value as CliActionHandler | undefined;
			if (!(handler instanceof Function) || !handler.$actionDefinition) continue;
			const action = {
				...handler.$actionDefinition,
				handler,
				handlerKey: key,
			} satisfies CliActionDefinition;
			const overrideIdx = actions.findIndex(item => item.path === action.path);
			if (overrideIdx >= 0) {
				actions.splice(overrideIdx, 1, action);
			} else {
				actions.push(action);
			}
		}

		const defaultActions = actions.filter(action => !action.path);
		if (defaultActions.length > 1) {
			throw new Error(`命令 ${target.name} 只能定义一个默认 action`);
		}
		Object.defineProperty(target, '$actions', { value: actions, writable: true, configurable: false, enumerable: false });
	};
}

export function action(path: string | undefined | null, schema: CliActionSchema) {
	return function (_target: object, _key: string | symbol, descriptor: TypedPropertyDescriptor<(...args: never[]) => unknown>) {
		if (!(descriptor.value instanceof Function)) {
			throw new Error('@action 只能用于函数');
		}
		(descriptor.value as CliActionHandler).$actionDefinition = {
			path: path?.trim() ?? '',
			schema,
		};
	};
}

export function getCliSchemaMeta(schema: TSchema): CliSchemaMeta {
	const current = schema as TSchema & { toJSONSchema?: () => TSchema };
	const jsonSchema = (typeof current.toJSONSchema === 'function' ? current.toJSONSchema() : current) as TSchema & {
		default?: unknown;
		description?: string;
		enum?: unknown[];
		examples?: unknown[];
		maxLength?: number;
		maximum?: number;
		minLength?: number;
		minimum?: number;
		type?: string;
	};
	return {
		defaultValue: jsonSchema.default,
		description: jsonSchema.description,
		enumValues: jsonSchema.enum,
		examples: jsonSchema.examples,
		maxLength: jsonSchema.maxLength,
		maximum: jsonSchema.maximum,
		minLength: jsonSchema.minLength,
		minimum: jsonSchema.minimum,
		required: (schema as TSchema & { [OptionalKind]?: string })[OptionalKind] !== 'Optional',
		type: jsonSchema.type,
	};
}

export function parseCliScalarValue(schema: TSchema, value: unknown) {
	const type = getCliSchemaMeta(schema).type;
	if (value === undefined || value === null || type === undefined) return value;
	if (type === 'integer' || type === 'number') {
		if (typeof value === 'number') return value;
		if (typeof value !== 'string' || value === '') return value;
		const parsed = type === 'integer' ? Number.parseInt(value, 10) : Number.parseFloat(value);
		return Number.isNaN(parsed) ? value : parsed;
	}
	return value;
}

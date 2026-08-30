/**
 * 模块组装设施：五个领域模块由 `createApp()` 按依赖顺序显式创建，
 * 通过注册表提供跨模块查找，不引入 DI 容器。
 */

export interface ModuleCommandConstructor {
	new (module: Module): object;
}

export class Module {
	readonly app: VoiceBriefApp;

	constructor(app: VoiceBriefApp) {
		this.app = app;
	}

	/** 该模块贡献的 CLI 命令，由 createApp 收集注册 */
	static readonly commands: readonly ModuleCommandConstructor[] = [];
}

export type ModuleClass = new (app: VoiceBriefApp) => Module;

export class VoiceBriefApp {
	private readonly $modules = new Map<string, Module>();

	/** 按既有依赖顺序显式创建并注册模块 */
	static create(types: readonly ModuleClass[]): VoiceBriefApp {
		const app = new VoiceBriefApp();
		for (const type of types) {
			app.register(new type(app));
		}
		return app;
	}

	register(module: Module) {
		this.$modules.set(module.constructor.name, module);
	}

	getModule<T extends ModuleClass>(target: T): InstanceType<T>;
	getModule(name: string): unknown;
	getModule(target: ModuleClass | string): Module | undefined {
		if (typeof target === 'string') {
			return this.$modules.get(target);
		}
		for (const module of this.$modules.values()) {
			if (module instanceof target) return module;
		}
		return undefined;
	}

	get modules(): readonly Module[] {
		return [...this.$modules.values()];
	}
}

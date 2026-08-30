/** 构建期注入的应用版本信息 */
declare const VERSION: {
	name: string;
};

/** 全局工具类型 */
declare type Nullable<T> = T | null | undefined;

/** Rspack / Vite 以原文方式加载的资源模块 */
declare module '*.yaml' {
	const value: { name?: string; command?: string } & Record<string, unknown>;
	export default value;
}

declare module '*.md' {
	const value: string;
	export default value;
}

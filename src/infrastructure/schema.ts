import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/**
 * 严格校验并填充默认值：任何类型不匹配都会抛错（不做类型转换），
 * 错误消息取首个校验错误的可读描述。
 */
export function parseValue<T extends TSchema>(schema: T, value: unknown): Static<T> {
	const errors = [...Value.Errors(schema, value)];
	if (errors.length > 0) throw new Error(errors[0]?.message ?? '校验失败');
	return Value.Cast(schema, value) as Static<T>;
}

/** 严格校验，通过时返回填充默认值后的结果，否则返回 undefined */
export function checkValue<T extends TSchema>(schema: T, value: unknown): Static<T> | undefined {
	if (!Value.Check(schema, value)) return undefined;
	return Value.Cast(schema, value) as Static<T>;
}

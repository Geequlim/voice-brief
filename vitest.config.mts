import yamlModule from '@rollup/plugin-yaml';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// @rollup/plugin-yaml 为 CJS/ESM 双格式包，TypeScript 7 原生版在该包的默认导出类型上存在互操作差异
const yaml = yamlModule as unknown as () => Plugin;

/** 与 Rspack 的 asset/source 规则等价：.md 以原文内容作为默认导出 */
function markdownRaw() {
	return {
		name: 'markdown-raw',
		transform(code: string, id: string): { code: string; map: null } | undefined {
			if (id.endsWith('.md')) {
				return { code: `export default ${JSON.stringify(code)}`, map: null };
			}
			return undefined;
		},
	};
}

export default defineConfig({
	plugins: [yaml(), markdownRaw()],
	define: {
		VERSION: JSON.stringify({ name: '0.0.0' }),
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts', 'tools/**/*.test.mts'],
		testTimeout: 300_000,
	},
});

import { defineConfig } from 'oxlint';

const warn = 'warn';
const error = 'error';
const off = 'off';

/**
 * 项目 Oxlint 规则。
 */
export default defineConfig({
	ignorePatterns: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.svelte', 'packages/cinnamon/dist/**', 'packages/cinnamon/extension/**'],
	rules: {
		'no-constant-condition': off,
		'no-useless-escape': off,
		'no-ex-assign': warn,
		'consistent-return': error,
		'no-else-return': warn,
		'no-var': warn,
		'prefer-const': [warn, { destructuring: 'all' }],
		'prefer-template': warn,
		'no-useless-return': warn,
		'no-debugger': warn,
		'no-prototype-builtins': off,
		'no-loss-of-precision': warn,
		'no-constant-binary-expression': warn,
		'prefer-rest-params': warn,
		'@typescript-eslint/no-require-imports': off,
		'@typescript-eslint/no-unused-expressions': off,
		'@typescript-eslint/no-unused-vars': [
			warn,
			{
				args: 'none',
				argsIgnorePattern: '.*',
				vars: 'all',
				ignoreRestSiblings: true,
				caughtErrors: 'none',
			},
		],
		'@typescript-eslint/class-literal-property-style': off,
		'@typescript-eslint/no-empty-function': off,
		'@typescript-eslint/no-inferrable-types': warn,
		'@typescript-eslint/consistent-indexed-object-style': warn,
		'@typescript-eslint/no-empty-object-type': warn,
		'@typescript-eslint/prefer-for-of': off,
		'@typescript-eslint/no-this-alias': warn,
		'@typescript-eslint/ban-ts-comment': off,
		'@typescript-eslint/consistent-type-definitions': off,
		'@typescript-eslint/no-namespace': off,
		'@typescript-eslint/consistent-type-imports': [
			error,
			{
				prefer: 'type-imports',
				fixStyle: 'separate-type-imports',
				disallowTypeAnnotations: false,
			},
		],
		'@typescript-eslint/no-import-type-side-effects': error,
	},
});

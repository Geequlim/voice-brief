import { flatConfigs as importXFlatConfigs } from 'eslint-plugin-import-x';
import Module from 'node:module';

// TypeScript 7 不再从包根暴露旧版 Compiler API，typescript-eslint 仍依赖它；
// 通过 npm 别名安装的 typescript@6（typescript-compiler-api）在加载期替换
const require = Module.createRequire(import.meta.url);
const legacyTypeScript = require('typescript-compiler-api');
const loadableModule = Module;
const originalLoad = loadableModule._load;
loadableModule._load = (request, parent, isMain) => {
	if (request === 'typescript') return legacyTypeScript;
	return originalLoad(request, parent, isMain);
};

const { default: tslint } = await import('typescript-eslint');

const warn = 'warn';
const error = 'error';

/** 通用 TypeScript 格式规则：Tab、单引号、分号等 */
const formatRules = {
	rules: {
		indent: [warn, 'tab', { SwitchCase: 1, ignoredNodes: ['PropertyDefinition'] }],
		quotes: [warn, 'single', { avoidEscape: true, allowTemplateLiterals: true }],
		semi: [warn, 'always'],
		'space-in-parens': [warn, 'never'],
		'no-multi-spaces': [warn, { ignoreEOLComments: true }],
		'no-multiple-empty-lines': [warn, { max: 2, maxEOF: 1 }],
		'no-trailing-spaces': warn,
		'object-curly-spacing': [warn, 'always'],
		'array-bracket-spacing': [warn, 'never'],
		'comma-spacing': [warn, { before: false, after: true }],
		'template-curly-spacing': [warn, 'never'],
		'func-call-spacing': [warn, 'never'],
		'no-mixed-spaces-and-tabs': warn,
	},
};

export default [
	{ ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.cache/**', 'packages/cinnamon/dist/**', 'packages/cinnamon/extension/**', '**/*.md'] },
	importXFlatConfigs.typescript,
	{
		files: ['**/*.ts', '**/*.mts', '**/*.cts'],
		languageOptions: {
			parser: tslint.parser,
		},
	},
	formatRules,
];


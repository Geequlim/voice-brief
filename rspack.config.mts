import fs from 'node:fs';
import path from 'node:path';
import rspack, { type Compiler, type RspackOptions } from '@rspack/core';

const workspace = __dirname;
const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')) as { version: string };

const BIN_WRAPPER = '#!/usr/bin/env node\n' +
	"process.argv[1] = require('node:path').resolve(__dirname, 'index.js');\n" +
	"require('./index.js');\n";

const INSTALL_SCRIPT_NAMES = ['install', 'postinstall', 'preinstall'] as const;

interface DependencyPackageJson {
	scripts?: Record<string, string>;
	gypfile?: boolean;
	os?: string[];
	cpu?: string[];
	optionalDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

function getDependencyName(request: string): string | undefined {
	if (!request.startsWith('.') && !request.startsWith('/')) {
		const parts = request.split('/');
		return request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
	}
	return undefined;
}

function containsNativeBinary(packageDirectory: string): boolean {
	const queue = [packageDirectory];
	while (queue.length) {
		const dir = queue.pop();
		if (!dir) continue;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) queue.push(full);
			else if (entry.name.endsWith('.node')) return true;
		}
	}
	return false;
}

/** 安全规则：含安装脚本、原生二进制、平台限定或可选运行时的包不打包，保持 external */
function isRuntimeExternal(request: string): boolean {
	const name = getDependencyName(request);
	if (!name) return false;
	const packageDirectory = path.join(workspace, 'node_modules', ...name.split('/'));
	const packageFile = path.join(packageDirectory, 'package.json');
	if (!fs.existsSync(packageFile)) return false;
	const json = JSON.parse(fs.readFileSync(packageFile, 'utf8')) as DependencyPackageJson;
	if (INSTALL_SCRIPT_NAMES.some(scriptName => typeof json.scripts?.[scriptName] === 'string')) return true;
	if (json.gypfile === true) return true;
	if (containsNativeBinary(packageDirectory)) return true;
	if ((json.os?.length ?? 0) > 0 || (json.cpu?.length ?? 0) > 0) return true;
	if (Object.keys(json.optionalDependencies || {}).length > 0) return true;
	if (Object.values(json.peerDependenciesMeta || {}).some(metadata => metadata.optional === true)) return true;
	return false;
}

/** 生成 bin wrapper */
class EmitBinWrapperPlugin {
	apply(compiler: Compiler) {
		compiler.hooks.thisCompilation.tap('voice-brief:emit-bin', compilation => {
			compilation.hooks.processAssets.tap(
				{
					name: 'voice-brief:emit-bin',
					stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
				},
				() => {
					compilation.emitAsset('index.bin.js', new compiler.webpack.sources.RawSource(BIN_WRAPPER));
				},
			);
		});
		compiler.hooks.afterEmit.tapPromise('voice-brief:chmod-bin', async () => {
			const bin = path.join(compiler.outputPath, 'index.bin.js');
			if (fs.existsSync(bin)) await fs.promises.chmod(bin, 0o755);
		});
	}
}

const config = (env: { production?: boolean } = {}): RspackOptions => ({
	context: workspace,
	mode: env.production ? 'production' : 'development',
	devtool: env.production ? 'source-map' : 'inline-source-map',
	target: 'node',
	entry: {
		index: './src/index.ts',
	},
	output: {
		path: path.join(workspace, 'dist', 'voice-brief'),
		filename: '[name].js',
		chunkFilename: '[name].js',
		library: {
			type: 'commonjs2',
		},
	},
	externals: [
		({ request }, callback) => {
			// 按完整请求路径 external（含 kkrpc/stdio 等子路径），仅以包名粒度判定是否安全
			if (typeof request === 'string' && isRuntimeExternal(request)) {
				return callback(null, `commonjs ${request}`);
			}
			return callback();
		},
	],
	resolve: {
		extensions: ['.ts', '.js', '.json'],
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: {
					loader: 'builtin:swc-loader',
					options: {
						jsc: {
							parser: {
								syntax: 'typescript',
								decorators: true,
							},
							transform: {
								useDefineForClassFields: false,
							},
							target: 'esnext',
						},
						module: {
							type: 'es6',
						},
					},
				},
			},
			{
				test: /\.ya?ml$/,
				use: path.join(workspace, 'tools', 'yaml-loader.mjs'),
			},
			{
				test: /\.md$/,
				type: 'asset/source',
			},
		],
	},
	optimization: {
		minimize: env.production ?? false,
		splitChunks: {
			cacheGroups: {
				dependencies: {
					test: /[\\/]node_modules[\\/]/,
					name: 'dependencies',
					chunks: 'all',
					enforce: true,
					priority: 10,
				},
			},
		},
	},
	plugins: [
		new rspack.DefinePlugin({
			VERSION: JSON.stringify({ name: pkg.version }),
		}),
		new EmitBinWrapperPlugin(),
	],
	stats: 'errors-warnings',
});

export default config;

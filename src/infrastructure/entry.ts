import path from 'node:path';

/**
 * 判断当前模块是否作为主入口运行。
 *
 * bin wrapper（index.bin.js）会把 process.argv[1] 重写为 bundle 入口的绝对路径，
 * 因此外层 require.main === module 判断不成立时，还需比对主脚本路径。
 */
export function isCurrentMainModule(): boolean {
	if (typeof process === 'undefined' || !process.versions?.node) return false;

	if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
		return true;
	}

	const mainScript = process.argv[1];
	if (!mainScript || typeof __filename !== 'string') return false;

	try {
		return path.resolve(mainScript) === path.normalize(__filename);
	} catch {
		return false;
	}
}

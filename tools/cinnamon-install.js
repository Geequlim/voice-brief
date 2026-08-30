#!/usr/bin/env node
/**
 * @tinyaxis/voice-brief-cinnamon 的 postinstall 安装脚本。
 *
 * 仅复制扩展文件到当前用户的 Cinnamon 扩展目录：
 * - 优先 $XDG_DATA_HOME，否则 ~/.local/share
 * - 先复制到同父目录临时目录，验证通过后 rename
 * - 替换已有安装时保留备份，失败自动恢复，成功后删除备份
 * - 不执行 gdbus，不强制重载或启用扩展
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const UUID = 'voice-brief@tinyaxis';
const packageRoot = path.resolve(__dirname, '..');
const extensionSource = path.join(packageRoot, 'extension', UUID);

function fail(message) {
	console.error(`[voice-brief-cinnamon] ${message}`);
	process.exit(1);
}

function validateExtension(directory, label) {
	const metadataFile = path.join(directory, 'metadata.json');
	if (!fs.existsSync(metadataFile)) fail(`${label} 缺少 metadata.json`);
	let metadata;
	try {
		metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
	} catch (error) {
		fail(`${label} 的 metadata.json 无法解析: ${error.message}`);
	}
	if (metadata.uuid !== UUID) fail(`${label} 的 uuid 与预期不符: ${metadata.uuid}`);
	if (!fs.existsSync(path.join(directory, 'extension.js'))) fail(`${label} 缺少扩展入口 extension.js`);
	return metadata;
}

function copyDirectory(source, target) {
	fs.mkdirSync(target, { recursive: true });
	for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
		const from = path.join(source, entry.name);
		const to = path.join(target, entry.name);
		if (entry.isDirectory()) copyDirectory(from, to);
		else if (entry.isFile()) fs.copyFileSync(from, to);
	}
}

function main() {
	validateExtension(extensionSource, '扩展产物');

	const dataHome = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim()
		? process.env.XDG_DATA_HOME
		: path.join(os.homedir(), '.local', 'share');
	const extensionsRoot = path.join(dataHome, 'cinnamon', 'extensions');
	const targetDirectory = path.join(extensionsRoot, UUID);
	const stagingDirectory = path.join(extensionsRoot, `.voice-brief-staging-${process.pid}-${Date.now()}`);
	const backupDirectory = path.join(extensionsRoot, `.voice-brief-backup-${UUID}`);

	fs.mkdirSync(extensionsRoot, { recursive: true });
	try {
		copyDirectory(extensionSource, stagingDirectory);
		validateExtension(stagingDirectory, '临时安装目录');

		const hadExisting = fs.existsSync(targetDirectory);
		if (hadExisting) fs.renameSync(targetDirectory, backupDirectory);
		try {
			fs.renameSync(stagingDirectory, targetDirectory);
		} catch (error) {
			if (hadExisting) {
				fs.rmSync(targetDirectory, { recursive: true, force: true });
				fs.renameSync(backupDirectory, targetDirectory);
			}
			throw error;
		}
		fs.rmSync(backupDirectory, { recursive: true, force: true });
	} finally {
		fs.rmSync(stagingDirectory, { recursive: true, force: true });
	}

	console.log(`[voice-brief-cinnamon] 已安装 ${UUID} 到 ${targetDirectory}`);
	console.log('[voice-brief-cinnamon] 如需立即生效，请在 Cinnamon 中重载或启用该扩展');
}

main();

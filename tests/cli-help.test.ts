import { describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/index';

/**
 * CLI 帮助快照。帮助文本属于对外兼容契约，
 * 修改命令定义导致差异时，先确认是否为行为回归。
 */
describe('CLI 帮助快照', () => {
	async function captureHelp(argv: string[]): Promise<string> {
		const chunks: string[] = [];
		const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
			chunks.push(String(chunk));
			return true;
		});
		try {
			await createApp().runCli(argv);
		} finally {
			spy.mockRestore();
		}
		return chunks.join('');
	}

	test('--help 帮助与快照一致', async () => {
		const text = await captureHelp(['--help']);
		expect(text).toBe('Usage: voice-brief [options] [command]\n\nOptions:\n  -V, --version                         output the version number\n  -h, --help                            display help for command\n\nCommands:\n  status [options]                      查看状态\n  init [options]                        初始化配置\n  on                                    开启语音简报\n  off                                   关闭语音简报\n  toggle                                切换语音简报\n  persona                               管理人设\n  speak [options] [text...]             播放最终语音简报\n  doctor [options]                      检查运行环境\n  provider                              查看 provider\n  runtime                               调整 daemon 运行配置\n  install [options] <persona> <target>  安装 agent 支持\n  uninstall [options] <target>          卸载 agent 支持\n  help [command]                        display help for command\n');
	});

	test('status --help 帮助与快照一致', async () => {
		const text = await captureHelp(['status', '--help']);
		expect(text).toBe('Usage: voice-brief status [options]\n\n查看 voice-brief 当前状态\n\nOptions:\n  --json      以 JSON 输出\n  -h, --help  display help for command\n');
	});

	test('init --help 帮助与快照一致', async () => {
		const text = await captureHelp(['init', '--help']);
		expect(text).toBe('Usage: voice-brief init [options]\n\n初始化 voice-brief 配置和内置人设\n\nOptions:\n  -f, --force  覆盖已存在的配置文件和内置人设\n  -h, --help   display help for command\n');
	});

	test('on --help 帮助与快照一致', async () => {
		const text = await captureHelp(['on', '--help']);
		expect(text).toBe('Usage: voice-brief on [options]\n\n开启语音简报\n\nOptions:\n  -h, --help  display help for command\n');
	});

	test('off --help 帮助与快照一致', async () => {
		const text = await captureHelp(['off', '--help']);
		expect(text).toBe('Usage: voice-brief off [options]\n\n关闭语音简报\n\nOptions:\n  -h, --help  display help for command\n');
	});

	test('toggle --help 帮助与快照一致', async () => {
		const text = await captureHelp(['toggle', '--help']);
		expect(text).toBe('Usage: voice-brief toggle [options]\n\n切换语音简报开关\n\nOptions:\n  -h, --help  display help for command\n');
	});

	test('speak --help 帮助与快照一致', async () => {
		const text = await captureHelp(['speak', '--help']);
		expect(text).toBe('Usage: voice-brief speak [options] [text...]\n\n播放最终回复前的语音简报\n\nArguments:\n  text                             要播报的文本\n\nOptions:\n  -a, --agent <agent> [value]      播报来源 agent 标识\n  -P, --progress                   按进度提示处理，启用 80 字截断和节流\n  -m, --model <model> [value]      播报来源模型标识\n  --priority <priority> [value]    进度优先级: normal 或 high\n  -H, --high                       等价于 --priority high\n  -p, --persona <persona> [value]  临时指定人设文件名，可省略 .md\n  -s, --session <session> [value]  播报所属会话标识\n  -h, --help                       display help for command\n');
	});

	test('doctor --help 帮助与快照一致', async () => {
		const text = await captureHelp(['doctor', '--help']);
		expect(text).toBe('Usage: voice-brief doctor [options]\n\n检查配置、provider 和播放器状态\n\nOptions:\n  --json      以 JSON 输出\n  -h, --help  display help for command\n');
	});

	test('install --help 帮助与快照一致', async () => {
		const text = await captureHelp(['install', '--help']);
		expect(text).toBe('Usage: voice-brief install [options] <persona> <target>\n\n安装 agent 全局提示词支持\n\nArguments:\n  persona                      人设文件名，可省略 .md\n  target                       codex、claude、opencode、copilot、pi、kimi-code 或\n                               zcode\n\nOptions:\n  --dry-run                    只输出将要修改的文件，不写入磁盘\n  --verbose <enabled> [value]  是否开启过程播报: true、false、on 或 off\n  -h, --help                   display help for command\n');
	});

	test('uninstall --help 帮助与快照一致', async () => {
		const text = await captureHelp(['uninstall', '--help']);
		expect(text).toBe('Usage: voice-brief uninstall [options] <target>\n\n移除 agent 全局提示词支持\n\nArguments:\n  target      codex、claude、opencode、copilot、pi、kimi-code 或 zcode\n\nOptions:\n  --dry-run   只输出将要修改的文件，不写入磁盘\n  -h, --help  display help for command\n');
	});

	test('persona --help 帮助与快照一致', async () => {
		const text = await captureHelp(['persona', '--help']);
		expect(text).toBe('Usage: voice-brief persona [options] [command]\n\n管理 markdown 人设文件\n\nOptions:\n  -h, --help      display help for command\n\nCommands:\n  list            列出人设\n  show <name>     查看人设\n  help [command]  display help for command\n');
	});

	test('persona list --help 帮助与快照一致', async () => {
		const text = await captureHelp(['persona', 'list', '--help']);
		expect(text).toBe('Usage: voice-brief persona list [options]\n\nOptions:\n  -h, --help  display help for command\n');
	});

	test('persona show --help 帮助与快照一致', async () => {
		const text = await captureHelp(['persona', 'show', '--help']);
		expect(text).toBe('Usage: voice-brief persona show [options] <name>\n\nArguments:\n  name        人设文件名，可省略 .md\n\nOptions:\n  -h, --help  display help for command\n');
	});

	test('provider --help 帮助与快照一致', async () => {
		const text = await captureHelp(['provider', '--help']);
		expect(text).toBe('Usage: voice-brief provider [options] [command]\n\n查看 TTS provider\n\nOptions:\n  -h, --help      display help for command\n\nCommands:\n  list            列出 provider\n  help [command]  display help for command\n');
	});

	test('provider list --help 帮助与快照一致', async () => {
		const text = await captureHelp(['provider', 'list', '--help']);
		expect(text).toBe('Usage: voice-brief provider list [options]\n\nOptions:\n  -h, --help  display help for command\n');
	});

	test('runtime --help 帮助与快照一致', async () => {
		const text = await captureHelp(['runtime', '--help']);
		expect(text).toBe('Usage: voice-brief runtime [options] [command]\n\n调整 daemon 运行配置\n\nOptions:\n  -h, --help           display help for command\n\nCommands:\n  configure [options]  调整 daemon 运行配置\n  help [command]       display help for command\n');
	});

	test('runtime configure --help 帮助与快照一致', async () => {
		const text = await captureHelp(['runtime', 'configure', '--help']);
		expect(text).toBe('Usage: voice-brief runtime configure [options]\n\nOptions:\n  --playback-start-delay-ms <milliseconds> <value>  播放器启动延迟毫秒数\n  -h, --help                                        display help for command\n');
	});

	test('help 子命令输出与 --help 一致', async () => {
		const chunks: string[] = [];
		const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
			chunks.push(String(chunk));
			return true;
		});
		try {
			await createApp().runCli(['help', 'status']);
		} finally {
			spy.mockRestore();
		}
		expect(chunks.join('')).toBe(await captureHelp(['status', '--help']));
	});
});

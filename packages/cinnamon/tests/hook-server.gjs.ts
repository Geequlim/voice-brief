
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const programPath = imports.system.programPath;
if (!programPath) throw new Error('Unable to resolve the test program path');
const packageDir = GLib.path_get_dirname(
	GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(programPath))),
);
imports.searchPath.unshift(GLib.build_filenamev([packageDir, 'dist', 'voice-brief@tinyaxis', 'lib']));

interface CompiledHookModules {
	'hook-server': {
		createHookServer(
			socketPath: string,
			parseEvent: (text: string) => VoiceBriefHookEvent,
			onEvent: (event: VoiceBriefHookEvent) => void,
			onError: (error: unknown) => void,
		): {
			start(): void;
			stop(): void;
		};
	};
	protocol: {
		parseHookEvent(text: string): VoiceBriefHookEvent;
	};
}

const compiledModules = imports as unknown as CompiledHookModules;
const { createHookServer } = compiledModules['hook-server'];
const { parseHookEvent: parseCompiledHookEvent } = compiledModules.protocol;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function send(socketPath: string, text: string): void {
	const client = new Gio.SocketClient();
	const connection = client.connect(new Gio.UnixSocketAddress({ path: socketPath }), null);
	connection.get_output_stream().write_all(new TextEncoder().encode(`${text}\n`), null);
	connection.close(null);
}

const tempDir = GLib.dir_make_tmp('voice-brief-cinnamon-test-XXXXXX');
const socketPath = GLib.build_filenamev([tempDir, 'hook.sock']);
const events: VoiceBriefHookEvent[] = [];
const errors: unknown[] = [];
const server = createHookServer(
	socketPath,
	parseCompiledHookEvent,
	event => events.push(event),
	error => errors.push(error),
);
const loop = new GLib.MainLoop(null, false);

try {
	server.start();
	assert(GLib.file_test(socketPath, GLib.FileTest.EXISTS), 'socket should exist after start');
	send(socketPath, '{invalid json');
	send(socketPath, 'x'.repeat(64 * 1024 + 1));
	const event = {
		protocol: 'voice-brief.hook-event',
		version: 2,
		eventId: 'event-1',
		occurredAt: '2026-08-28T00:00:00.000Z',
		briefId: 'brief-1',
		brief: {
			text: '流程已跑通',
			kind: 'final',
			priority: 'normal',
		},
		event: 'playback.ready',
		sequence: 4,
		source: {
			agent: 'codex',
			model: 'gpt-5',
			session: 'Cinnamon Hook 联调',
		},
		audio: {
			provider: 'fixture',
			source: 'provider',
			alignment: {
				source: 'fixture',
				cues: [{ text: '流', startMs: 0, endMs: 120, startChar: 0, endChar: 1 }],
			},
		},
	} satisfies VoiceBriefHookEvent;
	send(socketPath, JSON.stringify({ ...event, version: 1 }));
	send(socketPath, JSON.stringify({
		...event,
		eventId: 'event-v2',
		briefId: 'brief-v2',
		audio: { provider: 'legacy', source: 'provider' },
	}));
	send(socketPath, JSON.stringify(event));
	send(
		socketPath,
		JSON.stringify({
			...event,
			eventId: 'event-2',
			briefId: 'brief-2',
			brief: { ...event.brief, text: '' },
			event: 'brief.skipped',
			sequence: 1,
			reason: 'empty_text',
		}),
	);

	const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
		loop.quit();
		return GLib.SOURCE_REMOVE;
	});
	const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
		if (events.length !== 3 || errors.length !== 3) return GLib.SOURCE_CONTINUE;
		loop.quit();
		return GLib.SOURCE_REMOVE;
	});
	loop.run();
	if (GLib.main_context_default().find_source_by_id(timeoutId)) GLib.source_remove(timeoutId);
	if (GLib.main_context_default().find_source_by_id(pollId)) GLib.source_remove(pollId);

	assert(events.length === 3, `expected three valid events, received ${events.length}`);
	assert(errors.length === 3, `expected three rejected events, received ${errors.length}`);
	assert(events[0]?.version === 2 && !events[0]?.audio?.alignment, 'legacy v2 event should reach the consumer without alignment');
	assert(events[1]?.event === 'playback.ready', 'extended v2 event should reach the consumer');
	assert(events[1]?.audio?.alignment?.cues[0]?.text === '流', 'alignment should reach the consumer');
	assert(events[2]?.reason === 'empty_text', 'empty skipped event should reach the consumer');
} finally {
	server.stop();
	assert(!GLib.file_test(socketPath, GLib.FileTest.EXISTS), 'socket should be removed after stop');
	GLib.rmdir(tempDir);
}

print('GJS hook server tests passed');

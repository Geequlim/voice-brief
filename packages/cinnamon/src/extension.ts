/// <reference path="./hook-event.d.ts" />

declare const global: {
	log(message: string): void;
	logError(error: unknown, message: string): void;
};
declare function require(path: string): unknown;

interface HookServerHandle {
	start(): void;
	stop(): void;
}

type ExtensionDialoguePosition = 'bottom' | 'top';

interface DialogueOverlayHandle {
	handleEvent(event: VoiceBriefHookEvent): void;
	setPosition(position: ExtensionDialoguePosition): void;
	setScreenMargin(screenMargin: number): void;
	destroy(): void;
}

interface CinnamonExtensionMetadata {
	uuid: string;
}

interface CinnamonExtensionSettings {
	bind(key: string, property: string, callback: () => void): void;
	finalize(): void;
}

interface CinnamonSettingsModule {
	ExtensionSettings: new (target: object, uuid: string) => CinnamonExtensionSettings;
}

interface HookServerModule {
	createHookServer(
		socketPath: string,
		parseEvent: (text: string) => VoiceBriefHookEvent,
		onEvent: (event: VoiceBriefHookEvent) => void,
		onError: (error: unknown) => void,
	): HookServerHandle;
	getDefaultSocketPath(): string;
}

const {
	createHookServer: createExtensionHookServer,
	getDefaultSocketPath: getExtensionSocketPath,
} = require('./lib/hook-server') as HookServerModule;
const { parseHookEvent: parseExtensionHookEvent } = require('./lib/protocol') as {
	parseHookEvent(text: string): VoiceBriefHookEvent;
};
const {
	createDialogueOverlay: createExtensionDialogueOverlay,
	getDialoguePlaybackStartDelayMs: getExtensionPlaybackStartDelayMs,
} = require('./dialogue-overlay') as {
	createDialogueOverlay(position: ExtensionDialoguePosition, screenMargin: number): DialogueOverlayHandle;
	getDialoguePlaybackStartDelayMs(): number;
};
const ExtensionGio = imports.gi.Gio;
const ExtensionGLib = imports.gi.GLib;
const CinnamonSettings = (imports as unknown as { ui: { settings: CinnamonSettingsModule } }).ui.settings;

class VoiceBriefExtension {
	private readonly $uuid: string;
	private $screenMargin = 112;
	private $screenPosition: ExtensionDialoguePosition = 'top';
	private $settings?: CinnamonExtensionSettings;
	private $hookServer?: HookServerHandle;
	private $dialogueOverlay?: DialogueOverlayHandle;

	constructor(metadata: CinnamonExtensionMetadata) {
		this.$uuid = metadata.uuid;
	}

	enable(): void {
		const settings = new CinnamonSettings.ExtensionSettings(this, this.$uuid);
		settings.bind('screen-position', '$screenPosition', () => {
			this.$dialogueOverlay?.setPosition(this.$screenPosition);
		});
		settings.bind('screen-margin', '$screenMargin', () => {
			this.$dialogueOverlay?.setScreenMargin(this.$screenMargin);
		});
		const dialogueOverlay = createExtensionDialogueOverlay(this.$screenPosition, this.$screenMargin);
		const hookServer = createExtensionHookServer(
			getExtensionSocketPath(),
			parseExtensionHookEvent,
			event => dialogueOverlay.handleEvent(event),
			error => global.logError(error, '[voice-brief] rejected hook event'),
		);
		try {
			hookServer.start();
			this.$configurePlaybackStartDelay();
			this.$settings = settings;
			this.$dialogueOverlay = dialogueOverlay;
			this.$hookServer = hookServer;
		} catch (error) {
			settings.finalize();
			dialogueOverlay.destroy();
			throw error;
		}
	}

	private $configurePlaybackStartDelay(): void {
		const executable = ExtensionGLib.find_program_in_path('voice-brief');
		if (!executable) {
			global.log('[voice-brief] executable not found; playback start delay was not configured');
			return;
		}
		const delayMs = getExtensionPlaybackStartDelayMs();
		try {
			const process = ExtensionGio.Subprocess.new([
				executable,
				'runtime',
				'configure',
				'--playback-start-delay-ms',
				String(delayMs),
			], ExtensionGio.SubprocessFlags.STDOUT_SILENCE | ExtensionGio.SubprocessFlags.STDERR_SILENCE);
			process.wait_check_async(null, (_source, result) => {
				try {
					process.wait_check_finish(result);
					global.log(`[voice-brief] playback start delay configured to ${delayMs}ms`);
				} catch (error) {
					global.logError(error, '[voice-brief] failed to configure playback start delay');
				}
			});
		} catch (error) {
			global.logError(error, '[voice-brief] failed to start playback delay configuration');
		}
	}

	disable(): void {
		this.$hookServer?.stop();
		this.$settings?.finalize();
		this.$dialogueOverlay?.destroy();
		this.$settings = undefined;
		this.$hookServer = undefined;
		this.$dialogueOverlay = undefined;
	}
}

let extension: VoiceBriefExtension | undefined;

// oxlint-disable-next-line no-unused-vars -- Cinnamon invokes this lifecycle function through its extension loader.
function init(metadata: CinnamonExtensionMetadata): void {
	extension = new VoiceBriefExtension(metadata);
}

// oxlint-disable-next-line no-unused-vars -- Cinnamon invokes this lifecycle function through its extension loader.
function enable(): void {
	if (!extension) throw new Error('Voice Brief extension was not initialized');
	extension.enable();
}

// oxlint-disable-next-line no-unused-vars -- Cinnamon invokes this lifecycle function through its extension loader.
function disable(): void {
	extension?.disable();
}

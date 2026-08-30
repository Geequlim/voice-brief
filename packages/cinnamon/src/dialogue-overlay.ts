/// <reference path="./gjs-types.d.ts" />
/// <reference path="./hook-event.d.ts" />

interface CinnamonActor {
	visible: boolean;
	opacity: number;
	scale_x: number;
	scale_y: number;
	translation_x: number;
	translation_y: number;
	add_child(child: CinnamonActor): void;
	destroy(): void;
	ease(options: CinnamonEaseOptions): void;
	get_preferred_height(forWidth: number): [number, number];
	get_preferred_width(forHeight: number): [number, number];
	hide(): void;
	remove_all_transitions(): void;
	set_offscreen_redirect(mode: number): void;
	set_pivot_point(x: number, y: number): void;
	set_position(x: number, y: number): void;
	set_size(width: number, height: number): void;
	set_style(style: string): void;
	show(): void;
}

interface CinnamonEaseOptions {
	delay?: number;
	duration: number;
	mode: number;
	onStopped?: () => void;
	opacity?: number;
	scale_x?: number;
	scale_y?: number;
	translation_x?: number;
	translation_y?: number;
}

type CinnamonBoxLayout = CinnamonActor;
type CinnamonBin = CinnamonActor;
type CinnamonWidget = CinnamonActor;

interface CinnamonButton extends CinnamonActor {
	connect(signal: 'clicked', callback: () => void): number;
}

interface CinnamonLabel extends CinnamonActor {
	clutter_text: {
		ellipsize: number;
		line_wrap: boolean;
		line_wrap_mode: number;
	};
	text: string;
}

interface CinnamonSt {
	Align: {
		END: number;
	};
	Bin: new (properties: Record<string, unknown>) => CinnamonBin;
	BoxLayout: new (properties: Record<string, unknown>) => CinnamonBoxLayout;
	Button: new (properties: Record<string, unknown>) => CinnamonButton;
	Label: new (properties: Record<string, unknown>) => CinnamonLabel;
	Widget: new (properties: Record<string, unknown>) => CinnamonWidget;
}

interface CinnamonClutter {
	AnimationMode: {
		EASE_IN_QUAD: number;
		EASE_OUT_CUBIC: number;
	};
	ActorAlign: {
		CENTER: number;
		FILL: number;
		START: number;
	};
	FixedLayout: new () => unknown;
	OffscreenRedirect: {
		ALWAYS: number;
	};
}

interface CinnamonPango {
	EllipsizeMode: {
		END: number;
		NONE: number;
	};
	WrapMode: {
		WORD_CHAR: number;
	};
}

interface CinnamonMonitor {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface DialoguePoint {
	x: number;
	y: number;
}

interface DialogueRect extends DialoguePoint {
	height: number;
	width: number;
}

interface DialogueLayout {
	avatar: {
		final: DialoguePoint;
		initial: DialoguePoint;
		height: number;
		width: number;
	};
	finalPanel: DialogueRect;
	finalSurface: DialogueRect;
	root: DialogueRect;
}

type DialoguePhase = 'dialogue' | 'expanding' | 'exiting' | 'holding' | 'idle' | 'introducing';
type OverlayDialoguePosition = 'bottom' | 'top';

interface CinnamonMain {
	keybindingManager: {
		addHotKey(name: string, binding: string, callback: () => void): boolean;
		removeHotKey(name: string): void;
	};
	layoutManager: {
		primaryMonitor: CinnamonMonitor;
		addChrome(actor: CinnamonActor, options: Record<string, boolean>): void;
		removeChrome(actor: CinnamonActor): void;
		trackChrome(actor: CinnamonActor, options: Record<string, boolean>): void;
		untrackChrome(actor: CinnamonActor): void;
	};
}

const DialogueGio = imports.gi.Gio;
const DialogueGLib = imports.gi.GLib;
const DialogueClutter = (imports.gi as unknown as { Clutter: CinnamonClutter }).Clutter;
const DialoguePango = (imports.gi as unknown as { Pango: CinnamonPango }).Pango;
const St = (imports.gi as unknown as { St: CinnamonSt }).St;
const Main = (imports as unknown as { ui: { main: CinnamonMain } }).ui.main;

const FINAL_WIDTH = 1800;
const CARD_INSET_X = 18;
const CARD_INSET_Y = 14;
const CONTENT_GAP = 16;
const AVATAR_ENTER_DURATION_MS = 220;
const AVATAR_ENTER_SETTLE_DURATION_MS = 120;
const AVATAR_ENTER_HOLD_MS = 420;
const AVATAR_ENTER_OVERSHOOT_SCALE = 1.24;
const DIALOGUE_EXPAND_DURATION_MS = 190;
const PANEL_EMPHASIS_SCALE_Y = 1.06;
const PANEL_EMPHASIS_EXPAND_DURATION_MS = 90;
const PANEL_EMPHASIS_SETTLE_DURATION_MS = 110;
const PLAYBACK_START_DELAY_MS =
	AVATAR_ENTER_DURATION_MS +
	AVATAR_ENTER_SETTLE_DURATION_MS +
	AVATAR_ENTER_HOLD_MS +
	DIALOGUE_EXPAND_DURATION_MS +
	PANEL_EMPHASIS_EXPAND_DURATION_MS +
	PANEL_EMPHASIS_SETTLE_DURATION_MS;
const CONTENT_FADE_DURATION_MS = 130;
const EXIT_COLLAPSE_DURATION_MS = 200;
const EXIT_PANEL_FADE_DURATION_MS = 110;
const EXIT_AVATAR_HOLD_MS = 360;
const EXIT_AVATAR_PULSE_DURATION_MS = 120;
const EXIT_AVATAR_DURATION_MS = 150;
const EXIT_AVATAR_OVERSHOOT_SCALE = 1.22;
const DEFAULT_ACCENT_COLOR = '#eb4272';
const AVATAR_LAYOUT_STYLE = 'width: 96px; height: 96px;';
const HIDE_HOT_KEY_NAME = 'voice-brief-hide-overlay';

class DialogueOverlay {
	private readonly $root: CinnamonWidget;
	private readonly $surface: CinnamonWidget;
	private readonly $avatar: CinnamonBin;
	private readonly $dialoguePanel: CinnamonBoxLayout;
	private readonly $dialogueHideButton: CinnamonButton;
	private readonly $nameLabel: CinnamonLabel;
	private readonly $contextLabel: CinnamonLabel;
	private readonly $textLabel: CinnamonLabel;
	private $avatarTimeoutId?: number;
	private $briefId?: string;
	private readonly $dismissedBriefIds = new Set<string>();
	private $escapeHotKeyRegistered = false;
	private $layout?: DialogueLayout;
	private readonly $pendingBriefIds = new Set<string>();
	private $phase: DialoguePhase = 'idle';
	private $position: OverlayDialoguePosition;
	private $screenMargin: number;

	constructor(position: OverlayDialoguePosition, screenMargin: number) {
		this.$position = position;
		this.$screenMargin = screenMargin;
		this.$root = new St.Widget({
			layout_manager: new DialogueClutter.FixedLayout(),
			reactive: false,
		});
		this.$root.set_pivot_point(0.5, 0.5);
		this.$surface = new St.Widget({ style_class: 'voice-brief-dialogue-surface' });
		this.$surface.set_pivot_point(0.5, 0.5);
		this.$surface.set_offscreen_redirect(DialogueClutter.OffscreenRedirect.ALWAYS);

		this.$dialoguePanel = new St.BoxLayout({
			style_class: 'voice-brief-dialogue-panel',
			vertical: true,
		});
		const header = new St.BoxLayout({
			style_class: 'voice-brief-dialogue-header',
			x_expand: true,
		});
		this.$nameLabel = new St.Label({
			style_class: 'voice-brief-dialogue-name',
			y_align: DialogueClutter.ActorAlign.START,
		});
		this.$contextLabel = new St.Label({
			style_class: 'voice-brief-dialogue-runtime voice-brief-dialogue-context-label',
			x_align: DialogueClutter.ActorAlign.FILL,
			x_expand: true,
			y_align: DialogueClutter.ActorAlign.START,
		});
		this.$contextLabel.clutter_text.ellipsize = DialoguePango.EllipsizeMode.END;
		this.$contextLabel.clutter_text.line_wrap = false;
		this.$textLabel = new St.Label({
			style_class: 'voice-brief-dialogue-text',
			x_expand: true,
		});
		this.$textLabel.clutter_text.ellipsize = DialoguePango.EllipsizeMode.NONE;
		this.$textLabel.clutter_text.line_wrap = true;
		this.$textLabel.clutter_text.line_wrap_mode = DialoguePango.WrapMode.WORD_CHAR;
		this.$dialogueHideButton = new St.Button({
			style_class: 'voice-brief-dialogue-hide-button',
			label: '[Esc] 隐藏',
			reactive: true,
			can_focus: true,
		});
		this.$dialogueHideButton.connect('clicked', () => this.$dismissCurrentBrief());
		const dialogueHideControl = new St.Bin({
			child: this.$dialogueHideButton,
			style_class: 'voice-brief-dialogue-hide-row',
			x_align: St.Align.END,
			x_expand: true,
			x_fill: false,
		});
		header.add_child(this.$nameLabel);
		header.add_child(this.$contextLabel);
		this.$dialoguePanel.add_child(header);
		this.$dialoguePanel.add_child(this.$textLabel);
		this.$dialoguePanel.add_child(dialogueHideControl);
		this.$dialoguePanel.set_offscreen_redirect(DialogueClutter.OffscreenRedirect.ALWAYS);

		this.$avatar = new St.Bin({
			style_class: 'voice-brief-dialogue-avatar',
			y_align: DialogueClutter.ActorAlign.CENTER,
		});
		this.$avatar.set_pivot_point(0.5, 0.5);
		this.$root.add_child(this.$surface);
		this.$root.add_child(this.$dialoguePanel);
		this.$root.add_child(this.$avatar);
		this.$root.hide();
		Main.layoutManager.addChrome(this.$root, {
			visibleInFullscreen: true,
			affectsInputRegion: false,
			affectsStruts: false,
		});
		Main.layoutManager.trackChrome(this.$dialogueHideButton, {
			visibleInFullscreen: true,
			affectsInputRegion: true,
			affectsStruts: false,
		});
	}

	handleEvent(event: VoiceBriefHookEvent): void {
		const isTerminalEvent =
			event.event === 'audio.failed' ||
			event.event === 'playback.completed' ||
			event.event === 'playback.failed' ||
			event.event === 'playback.skipped';
		if (this.$dismissedBriefIds.has(event.briefId)) {
			if (isTerminalEvent) {
				this.$dismissedBriefIds.delete(event.briefId);
				this.$removePendingBrief(event.briefId);
			}
			return;
		}
		if (event.event === 'playback.queued') {
			this.$pendingBriefIds.add(event.briefId);
			return;
		}
		if (event.event === 'playback.ready') {
			if (this.$phase === 'holding') {
				this.$replaceDialogue(event);
				return;
			}
			this.$showDialogue(event);
			return;
		}
		if (event.event === 'playback.started') {
			this.$pendingBriefIds.delete(event.briefId);
			return;
		}
		if (isTerminalEvent) this.$handleTerminalEvent(event.briefId);
	}

	setPosition(position: OverlayDialoguePosition): void {
		this.$position = position;
		this.$updateRootPosition();
	}

	setScreenMargin(screenMargin: number): void {
		this.$screenMargin = screenMargin;
		this.$updateRootPosition();
	}

	destroy(): void {
		this.$clearTimers();
		this.$briefId = undefined;
		this.$dismissedBriefIds.clear();
		this.$pendingBriefIds.clear();
		this.$disableEscapeHotKey();
		this.$stopTransitions();
		Main.layoutManager.untrackChrome(this.$dialogueHideButton);
		Main.layoutManager.removeChrome(this.$root);
		this.$root.destroy();
	}

	private $showDialogue(event: VoiceBriefHookEvent): void {
		if (this.$phase !== 'idle') return;
		this.$briefId = event.briefId;
		const hasAvatar = this.$configureLayout(event);
		if (!this.$layout) return;
		if (!hasAvatar) {
			this.$showDialogueDirect(event);
			return;
		}

		this.$phase = 'introducing';
		this.$stopTransitions();
		this.$surface.hide();
		this.$dialoguePanel.hide();
		const avatarTranslation = this.$getAvatarTranslation(this.$layout.avatar.initial);
		this.$avatar.translation_x = avatarTranslation.x;
		this.$avatar.translation_y = avatarTranslation.y;
		this.$avatar.opacity = 0;
		this.$avatar.scale_x = 0.65;
		this.$avatar.scale_y = 0.65;
		this.$avatar.show();
		this.$root.opacity = 255;
		this.$root.scale_x = 1;
		this.$root.scale_y = 1;
		this.$root.translation_y = 0;
		this.$root.show();
		this.$animateAvatarEntrance(event.briefId);
	}

	private $animateAvatarEntrance(briefId: string): void {
		this.$avatar.ease({
			opacity: 255,
			scale_x: AVATAR_ENTER_OVERSHOOT_SCALE,
			scale_y: AVATAR_ENTER_OVERSHOOT_SCALE,
			duration: AVATAR_ENTER_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
			onStopped: () => {
				if (briefId !== this.$briefId || this.$phase !== 'introducing') return;
				this.$avatar.ease({
					scale_x: 1,
					scale_y: 1,
					duration: AVATAR_ENTER_SETTLE_DURATION_MS,
					mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
					onStopped: () => this.$holdAvatarBeforeDialogue(briefId),
				});
			},
		});
	}

	private $holdAvatarBeforeDialogue(briefId: string): void {
		if (briefId !== this.$briefId || this.$phase !== 'introducing') return;
		this.$avatarTimeoutId = DialogueGLib.timeout_add(DialogueGLib.PRIORITY_DEFAULT, AVATAR_ENTER_HOLD_MS, () => {
			this.$avatarTimeoutId = undefined;
			if (briefId !== this.$briefId || this.$phase !== 'introducing') return DialogueGLib.SOURCE_REMOVE;
			if (this.$layout) {
				const initialSurface = {
					x: this.$layout.avatar.initial.x,
					y: this.$layout.avatar.initial.y,
					width: this.$layout.avatar.width,
					height: this.$layout.avatar.height,
				};
				this.$expandDialogue(briefId, initialSurface);
			}
			return DialogueGLib.SOURCE_REMOVE;
		});
	}

	private $expandDialogue(briefId: string, initialSurface: DialogueRect): void {
		if (!this.$layout) return;
		this.$enableEscapeHotKey();
		this.$phase = 'expanding';
		const initialScaleX = initialSurface.width / this.$layout.finalSurface.width;
		const initialScaleY = initialSurface.height / this.$layout.finalSurface.height;
		const initialTranslationX =
			initialSurface.x + (initialSurface.width - this.$layout.finalSurface.width) / 2;
		const initialTranslationY =
			initialSurface.y + (initialSurface.height - this.$layout.finalSurface.height) / 2;
		this.$setRect(this.$dialoguePanel, this.$layout.finalPanel);
		this.$dialoguePanel.opacity = 0;
		this.$dialoguePanel.translation_y = 6;
		this.$dialoguePanel.show();
		this.$surface.scale_x = initialScaleX;
		this.$surface.scale_y = initialScaleY;
		this.$surface.translation_x = initialTranslationX;
		this.$surface.translation_y = initialTranslationY;
		this.$surface.opacity = 255;
		this.$surface.show();
		this.$surface.ease({
			scale_x: 1,
			scale_y: 1,
			translation_x: 0,
			translation_y: 0,
			duration: DIALOGUE_EXPAND_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
			onStopped: () => {
				if (briefId !== this.$briefId || this.$phase !== 'expanding') return;
				if (!this.$layout) return;
				this.$emphasizeDialogue(briefId, () => {
					this.$phase = 'dialogue';
				});
			},
		});
		this.$avatar.ease({
			translation_x: 0,
			translation_y: 0,
			duration: DIALOGUE_EXPAND_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
		});
		this.$dialoguePanel.ease({
			delay: 40,
			opacity: 255,
			translation_y: 0,
			duration: CONTENT_FADE_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
		});
	}

	private $emphasizeDialogue(briefId: string, onComplete: () => void): void {
		if (!this.$layout) return;
		const visibleRect = this.$layout.finalSurface;
		const pivotY = (visibleRect.y + visibleRect.height / 2) / this.$layout.root.height;
		this.$root.set_pivot_point(0.5, pivotY);
		this.$root.ease({
			scale_y: PANEL_EMPHASIS_SCALE_Y,
			duration: PANEL_EMPHASIS_EXPAND_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
			onStopped: () => {
				if (briefId !== this.$briefId || this.$phase !== 'expanding') return;
				this.$root.ease({
					scale_y: 1,
					duration: PANEL_EMPHASIS_SETTLE_DURATION_MS,
					mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
					onStopped: () => {
						if (briefId === this.$briefId && this.$phase === 'expanding') onComplete();
					},
				});
			},
		});
	}

	private $showDialogueDirect(event: VoiceBriefHookEvent): void {
		this.$briefId = event.briefId;
		this.$clearTimers();
		this.$stopTransitions();
		if (!this.$layout) return;
		this.$enableEscapeHotKey();
		this.$phase = 'expanding';
		this.$setRect(this.$surface, this.$layout.finalSurface);
		this.$surface.scale_x = 1;
		this.$surface.scale_y = 1;
		this.$surface.translation_x = 0;
		this.$surface.translation_y = 0;
		this.$surface.opacity = 0;
		this.$surface.show();
		this.$setRect(this.$dialoguePanel, this.$layout.finalPanel);
		this.$dialoguePanel.opacity = 0;
		this.$dialoguePanel.translation_y = 5;
		this.$dialoguePanel.show();
		this.$placeActor(this.$avatar, this.$layout.avatar.final);
		this.$avatar.translation_x = 0;
		this.$avatar.translation_y = 0;
		this.$avatar.opacity = 255;
		this.$avatar.scale_x = 1;
		this.$avatar.scale_y = 1;
		this.$root.opacity = 255;
		this.$root.scale_x = 1;
		this.$root.scale_y = 1;
		this.$root.translation_y = 0;
		this.$root.show();
		this.$surface.ease({
			opacity: 255,
			duration: CONTENT_FADE_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
			onStopped: () => {
				if (event.briefId !== this.$briefId || this.$phase !== 'expanding') return;
				if (!this.$layout) return;
				this.$emphasizeDialogue(event.briefId, () => {
					this.$phase = 'dialogue';
				});
			},
		});
		this.$dialoguePanel.ease({
			opacity: 255,
			translation_y: 0,
			duration: CONTENT_FADE_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
		});
	}

	private $replaceDialogue(event: VoiceBriefHookEvent): void {
		this.$briefId = event.briefId;
		this.$clearTimers();
		this.$stopTransitions();
		this.$configureLayout(event);
		if (!this.$layout) return;
		this.$enableEscapeHotKey();
		this.$phase = 'expanding';
		this.$showDialogueSteady();
		this.$emphasizeDialogue(event.briefId, () => {
			this.$phase = 'dialogue';
		});
	}

	private $showDialogueSteady(): void {
		if (!this.$layout) return;
		this.$setRect(this.$surface, this.$layout.finalSurface);
		this.$surface.scale_x = 1;
		this.$surface.scale_y = 1;
		this.$surface.translation_x = 0;
		this.$surface.translation_y = 0;
		this.$surface.opacity = 255;
		this.$surface.show();
		this.$setRect(this.$dialoguePanel, this.$layout.finalPanel);
		this.$dialoguePanel.opacity = 255;
		this.$dialoguePanel.translation_y = 0;
		this.$dialoguePanel.show();
		this.$placeActor(this.$avatar, this.$layout.avatar.final);
		this.$avatar.translation_x = 0;
		this.$avatar.translation_y = 0;
		this.$avatar.opacity = 255;
		this.$avatar.scale_x = 1;
		this.$avatar.scale_y = 1;
		this.$root.opacity = 255;
		this.$root.scale_x = 1;
		this.$root.scale_y = 1;
		this.$root.translation_y = 0;
		this.$root.show();
	}

	private $handleTerminalEvent(briefId: string): void {
		this.$removePendingBrief(briefId);
		if (briefId !== this.$briefId) return;
		if (this.$pendingBriefIds.size === 0) {
			this.$hide(briefId);
			return;
		}
		this.$holdDialogue(briefId);
	}

	private $removePendingBrief(briefId: string): void {
		this.$pendingBriefIds.delete(briefId);
		if (this.$phase === 'holding' && this.$pendingBriefIds.size === 0 && this.$briefId) {
			this.$hide(this.$briefId);
		}
	}

	private $holdDialogue(briefId: string): void {
		if (briefId !== this.$briefId) return;
		this.$clearTimers();
		this.$stopTransitions();
		this.$showDialogueSteady();
		this.$phase = 'holding';
	}

	private $hide(briefId: string): void {
		if (briefId !== this.$briefId) return;
		this.$clearTimers();
		this.$phase = 'exiting';
		this.$stopTransitions();
		this.$disableEscapeHotKey();
		this.$dialogueHideButton.hide();
		if (!this.$root.visible) {
			this.$finishHide(briefId);
			return;
		}
		this.$dialoguePanel.ease({
			opacity: 0,
			duration: 70,
			mode: DialogueClutter.AnimationMode.EASE_IN_QUAD,
		});
		if (!this.$layout || !this.$avatar.visible) {
			this.$fadeRoot(briefId);
			return;
		}
		if (!this.$surface.visible) {
			this.$fadeAvatar(briefId);
			return;
		}
		const initialAvatarTranslation = this.$getAvatarTranslation(this.$layout.avatar.initial);
		this.$surface.ease({
			scale_x: 0.96,
			scale_y: 0.96,
			opacity: 0,
			duration: EXIT_PANEL_FADE_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_IN_QUAD,
		});
		this.$avatar.ease({
			translation_x: initialAvatarTranslation.x,
			translation_y: initialAvatarTranslation.y,
			duration: EXIT_COLLAPSE_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
			onStopped: () => this.$fadeAvatar(briefId),
		});
	}

	private $dismissCurrentBrief(): void {
		if (!this.$briefId) return;
		this.$dismissedBriefIds.add(this.$briefId);
		this.$hide(this.$briefId);
	}

	private $enableEscapeHotKey(): void {
		if (this.$escapeHotKeyRegistered) return;
		this.$escapeHotKeyRegistered = Main.keybindingManager.addHotKey(
			HIDE_HOT_KEY_NAME,
			'Escape',
			() => this.$dismissCurrentBrief(),
		);
	}

	private $disableEscapeHotKey(): void {
		if (!this.$escapeHotKeyRegistered) return;
		Main.keybindingManager.removeHotKey(HIDE_HOT_KEY_NAME);
		this.$escapeHotKeyRegistered = false;
	}

	private $fadeAvatar(briefId: string): void {
		if (briefId !== this.$briefId || this.$phase !== 'exiting') return;
		this.$avatarTimeoutId = DialogueGLib.timeout_add(DialogueGLib.PRIORITY_DEFAULT, EXIT_AVATAR_HOLD_MS, () => {
			this.$avatarTimeoutId = undefined;
			if (briefId === this.$briefId && this.$phase === 'exiting') this.$pulseAvatarBeforeExit(briefId);
			return DialogueGLib.SOURCE_REMOVE;
		});
	}

	private $pulseAvatarBeforeExit(briefId: string): void {
		this.$avatar.ease({
			scale_x: EXIT_AVATAR_OVERSHOOT_SCALE,
			scale_y: EXIT_AVATAR_OVERSHOOT_SCALE,
			duration: EXIT_AVATAR_PULSE_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_OUT_CUBIC,
			onStopped: () => {
				if (briefId !== this.$briefId || this.$phase !== 'exiting') return;
				this.$avatar.ease({
					opacity: 0,
					scale_x: 0.65,
					scale_y: 0.65,
					duration: EXIT_AVATAR_DURATION_MS,
					mode: DialogueClutter.AnimationMode.EASE_IN_QUAD,
					onStopped: () => this.$finishHide(briefId),
				});
			},
		});
	}

	private $fadeRoot(briefId: string): void {
		this.$root.ease({
			opacity: 0,
			translation_y: -8,
			duration: EXIT_COLLAPSE_DURATION_MS,
			mode: DialogueClutter.AnimationMode.EASE_IN_QUAD,
			onStopped: () => this.$finishHide(briefId),
		});
	}

	private $finishHide(briefId: string): void {
		if (briefId !== this.$briefId || this.$phase !== 'exiting') return;
		this.$root.hide();
		this.$surface.hide();
		this.$dialoguePanel.hide();
		this.$root.scale_x = 1;
		this.$root.scale_y = 1;
		this.$briefId = undefined;
		this.$layout = undefined;
		this.$phase = 'idle';
	}

	private $configureLayout(event: VoiceBriefHookEvent): boolean {
		const accentColor = this.$resolveAccentColor(event.persona?.color);
		const personaName = event.persona?.name ?? 'Voice Brief';
		const metadata = [event.source?.agent, event.source?.model]
			.filter((value): value is string => value !== undefined)
			.join(' · ');
		const contextText = event.source?.session || metadata;
		this.$surface.set_style(`border-color: ${accentColor};`);
		this.$nameLabel.text = personaName;
		this.$nameLabel.set_style(`color: ${accentColor};`);
		this.$contextLabel.text = contextText;
		if (contextText) this.$contextLabel.show();
		else this.$contextLabel.hide();
		this.$textLabel.text = event.brief.text;
		this.$dialogueHideButton.show();
		const hasAvatar = this.$setAvatar(event.persona?.avatar);
		const [, measuredAvatarWidth] = this.$avatar.get_preferred_width(-1);
		const [, measuredAvatarHeight] = this.$avatar.get_preferred_height(measuredAvatarWidth);
		const avatarWidth = hasAvatar ? measuredAvatarWidth : 0;
		const avatarHeight = hasAvatar ? measuredAvatarHeight : 0;
		const monitor = Main.layoutManager.primaryMonitor;
		const finalWidth = Math.min(FINAL_WIDTH, monitor.width - 64);
		const avatarGap = hasAvatar ? CONTENT_GAP : 0;
		const finalPanelWidth = finalWidth - CARD_INSET_X * 2 - avatarWidth - avatarGap;
		this.$dialoguePanel.set_size(finalPanelWidth, -1);
		this.$dialoguePanel.show();
		const [, finalPanelHeight] = this.$dialoguePanel.get_preferred_height(finalPanelWidth);
		const finalHeight = Math.max(avatarHeight + CARD_INSET_Y * 2, finalPanelHeight + CARD_INSET_Y * 2);
		const rootHeight = finalHeight;
		const finalY = this.$getContentY(rootHeight, finalHeight);
		const finalAvatarX = CARD_INSET_X;
		this.$layout = {
			root: {
				x: monitor.x + Math.round((monitor.width - finalWidth) / 2),
				y: this.$getRootY(rootHeight),
				width: finalWidth,
				height: rootHeight,
			},
			finalSurface: { x: 0, y: finalY, width: finalWidth, height: finalHeight },
			avatar: {
				width: avatarWidth,
				height: avatarHeight,
				initial: {
					x: Math.round((finalWidth - avatarWidth) / 2),
					y: finalY + Math.round((finalHeight - avatarHeight) / 2),
				},
				final: {
					x: finalAvatarX,
					y: finalY + Math.round((finalHeight - avatarHeight) / 2),
				},
			},
			finalPanel: {
				x: finalAvatarX + avatarWidth + avatarGap,
				y: finalY + CARD_INSET_Y,
				width: finalPanelWidth,
				height: finalPanelHeight,
			},
		};
		this.$setRect(this.$root, this.$layout.root);
		this.$setRect(this.$surface, this.$layout.finalSurface);
		this.$placeActor(this.$avatar, this.$layout.avatar.final);
		this.$dialoguePanel.hide();
		return hasAvatar;
	}

	private $getContentY(rootHeight: number, contentHeight: number): number {
		if (this.$position === 'bottom') return rootHeight - contentHeight;
		return 0;
	}

	private $getRootY(rootHeight: number): number {
		const monitor = Main.layoutManager.primaryMonitor;
		if (this.$position === 'bottom') return monitor.y + monitor.height - this.$screenMargin - rootHeight;
		return monitor.y + this.$screenMargin;
	}

	private $updateRootPosition(): void {
		if (!this.$layout) return;
		this.$layout.root.y = this.$getRootY(this.$layout.root.height);
		this.$root.set_position(this.$layout.root.x, this.$layout.root.y);
	}

	private $setAvatar(avatarPath?: string): boolean {
		if (!avatarPath || !DialogueGLib.file_test(avatarPath, DialogueGLib.FileTest.IS_REGULAR)) {
			this.$avatar.hide();
			this.$avatar.set_style('');
			return false;
		}
		const avatarUri = DialogueGio.File.new_for_path(avatarPath).get_uri();
		this.$avatar.set_style(`${AVATAR_LAYOUT_STYLE} background-image: url("${avatarUri}"); background-size: cover;`);
		this.$avatar.show();
		return true;
	}

	private $setRect(actor: CinnamonActor, rect: DialogueRect): void {
		actor.set_position(rect.x, rect.y);
		actor.set_size(rect.width, rect.height);
	}

	private $placeActor(actor: CinnamonActor, point: DialoguePoint): void {
		actor.set_position(point.x, point.y);
	}

	private $getAvatarTranslation(point: DialoguePoint): DialoguePoint {
		if (!this.$layout) return { x: 0, y: 0 };
		return {
			x: point.x - this.$layout.avatar.final.x,
			y: point.y - this.$layout.avatar.final.y,
		};
	}

	private $stopTransitions(): void {
		this.$root.remove_all_transitions();
		this.$surface.remove_all_transitions();
		this.$avatar.remove_all_transitions();
		this.$dialoguePanel.remove_all_transitions();
	}

	private $clearTimers(): void {
		if (this.$avatarTimeoutId !== undefined) {
			DialogueGLib.Source.remove(this.$avatarTimeoutId);
			this.$avatarTimeoutId = undefined;
		}
	}

	private $resolveAccentColor(color?: string): string {
		if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
		return DEFAULT_ACCENT_COLOR;
	}
}

// oxlint-disable-next-line no-unused-vars -- Cinnamon exposes top-level functions through its legacy GJS module loader.
function createDialogueOverlay(position: OverlayDialoguePosition, screenMargin: number): DialogueOverlay {
	return new DialogueOverlay(position, screenMargin);
}

// oxlint-disable-next-line no-unused-vars -- Cinnamon exposes top-level functions through its legacy GJS module loader.
function getDialoguePlaybackStartDelayMs(): number {
	return PLAYBACK_START_DELAY_MS;
}

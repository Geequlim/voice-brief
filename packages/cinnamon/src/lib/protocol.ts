/// <reference path="../hook-event.d.ts" />
const EVENT_NAMES = new Set([
	'brief.skipped',
	'audio.preparing',
	'audio.ready',
	'audio.failed',
	'playback.queued',
	'playback.ready',
	'playback.started',
	'playback.completed',
	'playback.failed',
	'playback.skipped',
] as const);

const BRIEF_KINDS = new Set(['final', 'progress', 'test'] as const);
const PRIORITIES = new Set(['normal', 'high'] as const);
const AUDIO_SOURCES = new Set(['cache', 'provider'] as const);
const SKIP_REASONS = new Set(['disabled', 'duplicate', 'empty_text', 'player_disabled', 'throttled'] as const);

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string, allowEmpty = false): string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
		throw new Error(`${path} must be a string`);
	}
	return value;
}

function validateOptionalString(value: unknown, path: string): void {
	if (value !== undefined) requireString(value, path);
}

function validateSource(value: unknown): void {
	if (value === undefined) return;
	const source = requireRecord(value, 'source');
	validateOptionalString(source['agent'], 'source.agent');
	validateOptionalString(source['model'], 'source.model');
	validateOptionalString(source['session'], 'source.session');
}

function validatePersona(value: unknown): void {
	if (value === undefined) return;
	const persona = requireRecord(value, 'persona');
	requireString(persona['name'], 'persona.name');
	validateOptionalString(persona['avatar'], 'persona.avatar');
	validateOptionalString(persona['color'], 'persona.color');
}

function validateAudio(value: unknown): void {
	if (value === undefined) return;
	const audio = requireRecord(value, 'audio');
	requireString(audio['provider'], 'audio.provider');
	if (!AUDIO_SOURCES.has(audio['source'] as AudioSource)) throw new Error('audio.source is invalid');
	if (audio['durationMs'] !== undefined && (typeof audio['durationMs'] !== 'number' || audio['durationMs'] < 0)) {
		throw new Error('audio.durationMs must be a non-negative number');
	}
}

function validateError(value: unknown): void {
	if (value === undefined) return;
	const eventError = requireRecord(value, 'error');
	requireString(eventError['stage'], 'error.stage');
	requireString(eventError['message'], 'error.message');
}

// oxlint-disable-next-line no-unused-vars -- Cinnamon exposes top-level functions through its legacy GJS module loader.
function parseHookEvent(text: string): VoiceBriefHookEvent {
	const event = requireRecord(JSON.parse(text) as unknown, 'event');
	if (event['protocol'] !== 'voice-brief.hook-event') throw new Error('unsupported hook protocol');
	if (event['version'] !== 2) throw new Error('unsupported hook protocol version');
	requireString(event['eventId'], 'eventId');
	requireString(event['occurredAt'], 'occurredAt');
	requireString(event['briefId'], 'briefId');
	if (!EVENT_NAMES.has(event['event'] as HookEventName)) throw new Error('event name is invalid');
	if (!Number.isInteger(event['sequence']) || (event['sequence'] as number) < 1) {
		throw new Error('sequence must be a positive integer');
	}

	const brief = requireRecord(event['brief'], 'brief');
	requireString(brief['text'], 'brief.text', true);
	if (!BRIEF_KINDS.has(brief['kind'] as BriefKind)) throw new Error('brief.kind is invalid');
	if (!PRIORITIES.has(brief['priority'] as BriefPriority)) throw new Error('brief.priority is invalid');

	validateSource(event['source']);
	validatePersona(event['persona']);
	validateAudio(event['audio']);
	validateError(event['error']);
	if (event['reason'] !== undefined && !SKIP_REASONS.has(event['reason'] as SkipReason)) {
		throw new Error('reason is invalid');
	}
	return event as unknown as VoiceBriefHookEvent;
}

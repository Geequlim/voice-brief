import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

export const VOICE_BRIEF_HOOK_PROTOCOL = 'voice-brief.hook-event' as const;
export const VOICE_BRIEF_HOOK_PROTOCOL_VERSION = 2 as const;

const BriefKindSchema = Type.Union([Type.Literal('final'), Type.Literal('progress'), Type.Literal('test')]);
const ProgressPrioritySchema = Type.Union([Type.Literal('normal'), Type.Literal('high')]);
const AudioSourceSchema = Type.Union([Type.Literal('cache'), Type.Literal('provider')]);

export const VoiceBriefHookEventNameSchema = Type.Union([
	Type.Literal('brief.skipped'),
	Type.Literal('audio.preparing'),
	Type.Literal('audio.ready'),
	Type.Literal('audio.failed'),
	Type.Literal('playback.queued'),
	Type.Literal('playback.ready'),
	Type.Literal('playback.started'),
	Type.Literal('playback.completed'),
	Type.Literal('playback.failed'),
	Type.Literal('playback.skipped'),
]);

export const VoiceBriefHookSkipReasonSchema = Type.Union([
	Type.Literal('disabled'),
	Type.Literal('duplicate'),
	Type.Literal('empty_text'),
	Type.Literal('player_disabled'),
	Type.Literal('throttled'),
]);

export const VoiceBriefHookBriefSchema = Type.Object({
	text: Type.String(),
	kind: BriefKindSchema,
	priority: ProgressPrioritySchema,
}, { additionalProperties: false });

export const VoiceBriefHookSourceSchema = Type.Object({
	agent: Type.Optional(Type.String({ minLength: 1 })),
	model: Type.Optional(Type.String({ minLength: 1 })),
	session: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

export const VoiceBriefHookPersonaSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	avatar: Type.Optional(Type.String({ minLength: 1 })),
	color: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

export const VoiceBriefHookAudioSchema = Type.Object({
	provider: Type.String({ minLength: 1 }),
	source: AudioSourceSchema,
	durationMs: Type.Optional(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });

export const VoiceBriefHookErrorSchema = Type.Object({
	stage: Type.String({ minLength: 1 }),
	message: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

const HookContextProperties = {
	briefId: Type.String({ minLength: 1 }),
	brief: VoiceBriefHookBriefSchema,
	source: Type.Optional(VoiceBriefHookSourceSchema),
	persona: Type.Optional(VoiceBriefHookPersonaSchema),
} as const;

export const VoiceBriefHookContextSchema = Type.Object(HookContextProperties, { additionalProperties: false });

const HookEventInputProperties = {
	...HookContextProperties,
	event: VoiceBriefHookEventNameSchema,
	sequence: Type.Integer({ minimum: 1 }),
	audio: Type.Optional(VoiceBriefHookAudioSchema),
	error: Type.Optional(VoiceBriefHookErrorSchema),
	reason: Type.Optional(Type.Union([VoiceBriefHookSkipReasonSchema, Type.Null()])),
} as const;

export const VoiceBriefHookEventInputSchema = Type.Object(HookEventInputProperties, { additionalProperties: false });

export const VoiceBriefHookEventSchema = Type.Object({
	protocol: Type.Literal(VOICE_BRIEF_HOOK_PROTOCOL),
	version: Type.Literal(VOICE_BRIEF_HOOK_PROTOCOL_VERSION),
	eventId: Type.String({ minLength: 1 }),
	occurredAt: Type.String({ minLength: 1 }),
	...HookEventInputProperties,
}, { additionalProperties: false });

export type VoiceBriefHookAudio = Static<typeof VoiceBriefHookAudioSchema>;
export type VoiceBriefHookBrief = Static<typeof VoiceBriefHookBriefSchema>;
export type VoiceBriefHookContext = Static<typeof VoiceBriefHookContextSchema>;
export type VoiceBriefHookError = Static<typeof VoiceBriefHookErrorSchema>;
export type VoiceBriefHookEvent = Static<typeof VoiceBriefHookEventSchema>;
export type VoiceBriefHookEventInput = Static<typeof VoiceBriefHookEventInputSchema>;
export type VoiceBriefHookEventName = Static<typeof VoiceBriefHookEventNameSchema>;
export type VoiceBriefHookPersona = Static<typeof VoiceBriefHookPersonaSchema>;
export type VoiceBriefHookSkipReason = Static<typeof VoiceBriefHookSkipReasonSchema>;
export type VoiceBriefHookSource = Static<typeof VoiceBriefHookSourceSchema>;

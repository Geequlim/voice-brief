import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

export const FishAudioFormatSchema = Type.Union([
	Type.Literal('wav'),
	Type.Literal('pcm'),
	Type.Literal('mp3'),
	Type.Literal('opus'),
]);

const FishProviderOptions = {
	apiKeyEnv: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	format: Type.Optional(Type.Union([FishAudioFormatSchema, Type.Null()])),
	model: Type.Optional(Type.String({ minLength: 1 })),
	referenceId: Type.Optional(Type.String({ minLength: 1 })),
	volume: Type.Optional(Type.Number({ minimum: 0, maximum: 4 })),
} as const;

export const FishProviderConfigSchema = Type.Object({
	...FishProviderOptions,
	concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export const FishPersonaConfigSchema = Type.Object(FishProviderOptions, { additionalProperties: false });

const EdgeProviderOptions = {
	rate: Type.Optional(Type.String({ pattern: '^[+-]\\d+%$' })),
	voice: Type.Optional(Type.String({ minLength: 1 })),
	volume: Type.Optional(Type.Number({ minimum: 0, maximum: 4 })),
} as const;

export const EdgeProviderConfigSchema = Type.Object({
	...EdgeProviderOptions,
	concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export const EdgePersonaConfigSchema = Type.Object(EdgeProviderOptions, { additionalProperties: false });

export const MockProviderConfigSchema = Type.Object({
	concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
	outputText: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const OpenAiSpeechFormatSchema = Type.Union([
	Type.Literal('mp3'),
	Type.Literal('opus'),
	Type.Literal('aac'),
	Type.Literal('flac'),
	Type.Literal('wav'),
]);

const OpenAiProviderOptions = {
	apiKeyEnv: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	format: Type.Optional(Type.Union([OpenAiSpeechFormatSchema, Type.Null()])),
	model: Type.Optional(Type.String({ minLength: 1 })),
	voice: Type.Optional(Type.String({ minLength: 1 })),
	volume: Type.Optional(Type.Number({ minimum: 0, maximum: 4 })),
} as const;

export const OpenAiProviderConfigSchema = Type.Object({
	...OpenAiProviderOptions,
	concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export const OpenAiPersonaConfigSchema = Type.Object(OpenAiProviderOptions, { additionalProperties: false });

const AudioCppProviderOptions = {
	apiKeyEnv: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	family: Type.Optional(Type.String({ minLength: 1 })),
	model: Type.Optional(Type.String({ minLength: 1 })),
	modelPath: Type.Optional(Type.String({ minLength: 1 })),
	referenceText: Type.Optional(Type.String({ minLength: 1 })),
	seed: Type.Optional(Type.Integer({ minimum: 0 })),
	voice: Type.Optional(Type.String({ minLength: 1 })),
	voiceRef: Type.Optional(Type.String({ minLength: 1 })),
	volume: Type.Optional(Type.Number({ minimum: 0, maximum: 4 })),
} as const;

export const AudioCppProviderConfigSchema = Type.Object({
	...AudioCppProviderOptions,
	concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export const AudioCppPersonaConfigSchema = Type.Object(AudioCppProviderOptions, { additionalProperties: false });

export const AudioCppAlignmentConfigSchema = Type.Object({
	apiKeyEnv: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	family: Type.Optional(Type.String({ minLength: 1 })),
	language: Type.Optional(Type.String({ minLength: 1 })),
	model: Type.Optional(Type.String({ minLength: 1 })),
	modelPath: Type.Optional(Type.String({ minLength: 1 })),
	timeoutMs: Type.Optional(Type.Number({ minimum: 1 })),
}, { additionalProperties: false });

const AlignmentConfigSchema = Type.Object({
	enabled: Type.Boolean(),
	provider: Type.String({ minLength: 1 }),
	audiocpp: Type.Optional(AudioCppAlignmentConfigSchema),
}, { additionalProperties: false });

const AlignmentConfigInputSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
	provider: Type.Optional(Type.String({ minLength: 1 })),
	audiocpp: Type.Optional(AudioCppAlignmentConfigSchema),
}, { additionalProperties: false });

const StdinHookConfigSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	timeoutMs: Type.Optional(Type.Number({ minimum: 1 })),
	transport: Type.Literal('stdin'),
	command: Type.String({ minLength: 1 }),
	args: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });

const UnixHookConfigSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	timeoutMs: Type.Optional(Type.Number({ minimum: 1 })),
	transport: Type.Literal('unix'),
	socket: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const VoiceBriefHookConfigSchema = Type.Union([StdinHookConfigSchema, UnixHookConfigSchema]);

const DuckingConfigSchema = Type.Object({
	enabled: Type.Boolean(),
	attenuationDb: Type.Number({ minimum: 1 }),
	restoreFadeMs: Type.Number({ minimum: 0 }),
}, { additionalProperties: false });

const DuckingConfigInputSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
	attenuationDb: Type.Optional(Type.Number({ minimum: 1 })),
	restoreFadeMs: Type.Optional(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });

const ProvidersConfigSchema = Type.Object({
	audiocpp: Type.Optional(AudioCppProviderConfigSchema),
	edge: Type.Optional(EdgeProviderConfigSchema),
	fish: Type.Optional(FishProviderConfigSchema),
	mock: Type.Optional(MockProviderConfigSchema),
	openai: Type.Optional(OpenAiProviderConfigSchema),
}, { additionalProperties: false });

const PlaybackConfigSchema = Type.Object({
	command: Type.String({ minLength: 1 }),
	startDelayMs: Type.Number({ minimum: 0 }),
	ducking: DuckingConfigSchema,
}, { additionalProperties: false });

const PlaybackConfigInputSchema = Type.Object({
	command: Type.Optional(Type.String({ minLength: 1 })),
	startDelayMs: Type.Optional(Type.Number({ minimum: 0 })),
	ducking: Type.Optional(DuckingConfigInputSchema),
}, { additionalProperties: false });

const CacheConfigSchema = Type.Object({
	enabled: Type.Boolean(),
	ttlMs: Type.Number({ minimum: 0 }),
	maxEntries: Type.Integer({ minimum: 0 }),
	pruneIntervalMs: Type.Number({ minimum: 0 }),
}, { additionalProperties: false });

const CacheConfigInputSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
	ttlMs: Type.Optional(Type.Number({ minimum: 0 })),
	maxEntries: Type.Optional(Type.Integer({ minimum: 0 })),
	pruneIntervalMs: Type.Optional(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });

const ThrottleConfigSchema = Type.Object({
	progressIntervalMs: Type.Number({ minimum: 1 }),
	highPriorityIntervalMs: Type.Number({ minimum: 1 }),
	networkCheckTtlMs: Type.Number({ minimum: 1 }),
}, { additionalProperties: false });

const ThrottleConfigInputSchema = Type.Object({
	progressIntervalMs: Type.Optional(Type.Number({ minimum: 1 })),
	highPriorityIntervalMs: Type.Optional(Type.Number({ minimum: 1 })),
	networkCheckTtlMs: Type.Optional(Type.Number({ minimum: 1 })),
}, { additionalProperties: false });

export const VoiceBriefConfigSchema = Type.Object({
	version: Type.Literal(1),
	enabled: Type.Boolean(),
	provider: Type.String({ minLength: 1 }),
	fallbackProvider: Type.Optional(Type.String({ minLength: 1 })),
	alignment: AlignmentConfigSchema,
	hooks: Type.Array(VoiceBriefHookConfigSchema),
	providers: ProvidersConfigSchema,
	playback: PlaybackConfigSchema,
	cache: CacheConfigSchema,
	throttle: ThrottleConfigSchema,
}, { additionalProperties: false });

export const VoiceBriefConfigInputSchema = Type.Object({
	version: Type.Optional(Type.Literal(1)),
	enabled: Type.Optional(Type.Boolean()),
	provider: Type.Optional(Type.String({ minLength: 1 })),
	fallbackProvider: Type.Optional(Type.String({ minLength: 1 })),
	alignment: Type.Optional(AlignmentConfigInputSchema),
	hooks: Type.Optional(Type.Array(VoiceBriefHookConfigSchema)),
	providers: Type.Optional(ProvidersConfigSchema),
	playback: Type.Optional(PlaybackConfigInputSchema),
	cache: Type.Optional(CacheConfigInputSchema),
	throttle: Type.Optional(ThrottleConfigInputSchema),
}, { additionalProperties: false });

export const VoiceBriefStateSchema = Type.Object({
	lastFinalAt: Type.Optional(Type.Number()),
	lastProgressAt: Type.Optional(Type.Number()),
	lastProgressHash: Type.Optional(Type.String({ minLength: 1 })),
	lastProviderError: Type.Optional(Type.String({ minLength: 1 })),
	lastPlaybackError: Type.Optional(Type.String({ minLength: 1 })),
	lastCachePruneAt: Type.Optional(Type.Number()),
}, { additionalProperties: false });

export type AudioCppProviderConfig = Static<typeof AudioCppProviderConfigSchema>;
export type AudioCppAlignmentConfig = Static<typeof AudioCppAlignmentConfigSchema>;
export type EdgeProviderConfig = Static<typeof EdgeProviderConfigSchema>;
export type FishProviderConfig = Static<typeof FishProviderConfigSchema>;
export type MockProviderConfig = Static<typeof MockProviderConfigSchema>;
export type OpenAiProviderConfig = Static<typeof OpenAiProviderConfigSchema>;
export type VoiceBriefConfig = Static<typeof VoiceBriefConfigSchema>;
export type VoiceBriefConfigInput = Static<typeof VoiceBriefConfigInputSchema>;
export type VoiceBriefHookConfig = Static<typeof VoiceBriefHookConfigSchema>;
export type VoiceBriefState = Static<typeof VoiceBriefStateSchema>;
export type VoiceBriefStdinHookConfig = Extract<VoiceBriefHookConfig, { transport: 'stdin'; }>;
export type VoiceBriefUnixHookConfig = Extract<VoiceBriefHookConfig, { transport: 'unix'; }>;

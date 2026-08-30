import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { AudioCppPersonaConfigSchema, EdgePersonaConfigSchema, FishPersonaConfigSchema, OpenAiPersonaConfigSchema } from '../config/schema';

export const VoicePersonaFrontMatterSchema = Type.Object({
	avatar: Type.Optional(Type.String({ minLength: 1 })),
	color: Type.Optional(Type.String({ minLength: 1 })),
	provider: Type.Optional(Type.String({ minLength: 1 })),
	fallbackProvider: Type.Optional(Type.String({ minLength: 1 })),
	edge: Type.Optional(EdgePersonaConfigSchema),
	fish: Type.Optional(FishPersonaConfigSchema),
	openai: Type.Optional(OpenAiPersonaConfigSchema),
	audiocpp: Type.Optional(AudioCppPersonaConfigSchema),
}, { additionalProperties: false });

export type VoicePersonaFrontMatter = Static<typeof VoicePersonaFrontMatterSchema>;

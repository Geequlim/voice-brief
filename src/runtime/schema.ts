import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

const BriefKindSchema = Type.Union([Type.Literal('final'), Type.Literal('progress')]);

const ProgressPrioritySchema = Type.Union([Type.Literal('normal'), Type.Literal('high')]);

const SpeakTextOptionsSchema = Type.Object({
	agent: Type.Optional(Type.String()),
	model: Type.Optional(Type.String()),
	personaName: Type.Optional(Type.String()),
	priority: Type.Optional(Type.Union([ProgressPrioritySchema, Type.Null()])),
	session: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const DaemonSubmitRequestSchema = Type.Object({
	kind: BriefKindSchema,
	text: Type.String(),
	options: Type.Optional(SpeakTextOptionsSchema),
}, { additionalProperties: false });

export const DaemonRuntimeConfigInputSchema = Type.Object({
	playbackStartDelayMs: Type.Number({ minimum: 0 }),
}, { additionalProperties: false });

export const PactlSinkInputsSchema = Type.Array(Type.Object({
	index: Type.Number(),
	corked: Type.Optional(Type.Boolean()),
	volume: Type.Record(Type.String(), Type.Object({
		value: Type.Number(),
	})),
	properties: Type.Optional(Type.Record(Type.String(), Type.String())),
}));

const DuckingStreamSchema = Type.Object({
	index: Type.Number(),
	restoreId: Type.Optional(Type.String({ minLength: 1 })),
	originalVolumes: Type.Array(Type.Number()),
	duckedVolumes: Type.Array(Type.Number()),
}, { additionalProperties: false });

export const DuckingJournalSchema = Type.Object({
	pid: Type.Integer({ minimum: 1 }),
	streams: Type.Array(DuckingStreamSchema),
	pending: Type.Optional(Type.Array(DuckingStreamSchema)),
}, { additionalProperties: false });

export type DuckingJournal = Static<typeof DuckingJournalSchema>;
export type DuckingStream = Static<typeof DuckingStreamSchema>;
export type PactlSinkInput = Static<typeof PactlSinkInputsSchema>[number];

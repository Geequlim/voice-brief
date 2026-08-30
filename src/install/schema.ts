import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

const ClaudeSettingsPermissionsSchema = Type.Object({
	allow: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: Type.Unknown() });

export const ClaudeSettingsSchema = Type.Object({
	permissions: Type.Optional(ClaudeSettingsPermissionsSchema),
}, { additionalProperties: Type.Unknown() });

export type ClaudeSettings = Static<typeof ClaudeSettingsSchema>;


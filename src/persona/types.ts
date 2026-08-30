import type { VoicePersonaFrontMatter } from './schema';

export type VoicePersona = VoicePersonaFrontMatter & {
	fileName: string;
	name: string;
	instructions: string;
};

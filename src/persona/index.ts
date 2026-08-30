import { Module } from '../infrastructure/module';
import { VoiceBriefPersonaCommand } from './command';
import { VoiceBriefPersonaService } from './services/persona-service';

/** voice-brief 人设模块 */
export class VoiceBriefPersonaModule extends Module {
	static readonly commands = [VoiceBriefPersonaCommand];

	readonly personaService = new VoiceBriefPersonaService(this);
}

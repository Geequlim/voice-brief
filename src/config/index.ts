import { Module } from '../infrastructure/module';
import { VoiceBriefInitCommand, VoiceBriefOffCommand, VoiceBriefOnCommand, VoiceBriefStatusCommand, VoiceBriefToggleCommand } from './command';
import { VoiceBriefConfigService } from './services/config-service';
import { VoiceBriefPathService } from './services/path-service';
import { VoiceBriefStateService } from './services/state-service';

/** voice-brief 配置模块 */
export class VoiceBriefConfigModule extends Module {
	static readonly commands = [VoiceBriefStatusCommand, VoiceBriefInitCommand, VoiceBriefOnCommand, VoiceBriefOffCommand, VoiceBriefToggleCommand];

	readonly pathService = new VoiceBriefPathService(this);
	readonly configService = new VoiceBriefConfigService(this);
	readonly stateService = new VoiceBriefStateService(this);
}

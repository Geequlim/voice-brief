import { Module } from '../infrastructure/module';
import { VoiceBriefInstallCommandGroup, VoiceBriefUninstallCommandGroup } from './command';
import { VoiceBriefInstallService } from './services/install-service';
import { VoiceBriefMarkerBlockService } from './services/marker-block-service';

/** voice-brief 安装模块 */
export class VoiceBriefInstallModule extends Module {
	static readonly commands = [VoiceBriefInstallCommandGroup, VoiceBriefUninstallCommandGroup];

	readonly markerBlockService = new VoiceBriefMarkerBlockService(this);
	readonly installService = new VoiceBriefInstallService(this);
}

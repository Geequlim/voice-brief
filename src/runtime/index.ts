import { Module } from '../infrastructure/module';
import { VoiceBriefDoctorCommand, VoiceBriefProviderCommand, VoiceBriefRuntimeConfigCommand, VoiceBriefSpeakCommand } from './command';
import { VoiceBriefAudioMetadataService } from './services/audio-metadata-service';
import { VoiceBriefPlaybackService } from './services/playback-service';
import { VoiceBriefProviderService } from './services/provider-service';
import { VoiceBriefCacheService } from './services/cache-service';
import { VoiceBriefDuckingService } from './services/ducking-service';
import { VoiceBriefDaemonClientService } from './services/daemon-client-service';
import { VoiceBriefDaemonEndpointService } from './services/daemon-endpoint-service';
import { VoiceBriefDaemonService } from './services/daemon-service';
import { VoiceBriefRuntimeService } from './services/runtime-service';
import { VoiceBriefSchedulerService } from './services/scheduler-service';
import { VoiceBriefThrottleService } from './services/throttle-service';

/** voice-brief 运行时模块 */
export class VoiceBriefRuntimeModule extends Module {
	static readonly commands = [VoiceBriefSpeakCommand, VoiceBriefDoctorCommand, VoiceBriefProviderCommand, VoiceBriefRuntimeConfigCommand];

	readonly daemonEndpointService = new VoiceBriefDaemonEndpointService(this);
	readonly daemonService = new VoiceBriefDaemonService(this);
	readonly daemonClientService = new VoiceBriefDaemonClientService(this);
	readonly cacheService = new VoiceBriefCacheService(this);
	readonly providerService = new VoiceBriefProviderService(this);
	readonly audioMetadataService = new VoiceBriefAudioMetadataService(this);
	readonly duckingService = new VoiceBriefDuckingService(this);
	readonly playbackService = new VoiceBriefPlaybackService(this);
	readonly throttleService = new VoiceBriefThrottleService(this);
	readonly runtimeService = new VoiceBriefRuntimeService(this);
	readonly schedulerService = new VoiceBriefSchedulerService(this);
}

import { Module } from '../infrastructure/module';
import { VoiceBriefHookService } from './services/hook-service';
import { VoiceBriefStdinHookTransport } from './transports/stdin-transport';
import { VoiceBriefUnixHookTransport } from './transports/unix-transport';

/** voice-brief Hook 模块 */
export class VoiceBriefHookModule extends Module {
	readonly stdinTransport = new VoiceBriefStdinHookTransport();
	readonly unixTransport = new VoiceBriefUnixHookTransport();
	readonly hookService = new VoiceBriefHookService(this);
}

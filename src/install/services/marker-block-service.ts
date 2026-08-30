import type { VoiceBriefInstallModule } from '../index';

export class VoiceBriefMarkerBlockService {
	constructor(readonly module: VoiceBriefInstallModule) {}

	upsert(text: string, id: string, content: string) {
		const start = this.markerStart(id);
		const end = this.markerEnd(id);
		const block = `${start}\n${content.trim()}\n${end}`;
		const pattern = new RegExp(`${this.escapeRegExp(start)}[\\s\\S]*?${this.escapeRegExp(end)}`, 'm');
		if (pattern.test(text)) return text.replace(pattern, block);
		if (!text.trim()) return `${block}\n`;
		const prefix = text.endsWith('\n') ? text : `${text}\n`;
		return `${prefix}\n${block}\n`;
	}

	remove(text: string, id: string) {
		const pattern = new RegExp(`\\n?${this.escapeRegExp(this.markerStart(id))}[\\s\\S]*?${this.escapeRegExp(this.markerEnd(id))}\\n?`, 'm');
		return text.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimStart();
	}

	private markerStart(id: string) {
		return `<!-- voice-brief:${id}:start -->`;
	}

	private markerEnd(id: string) {
		return `<!-- voice-brief:${id}:end -->`;
	}

	private escapeRegExp(text: string) {
		return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}

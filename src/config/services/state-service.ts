import { parseValue } from '../../infrastructure/schema';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { hasErrorCode } from '../../error';
import { VoiceBriefStateSchema } from '../schema';
import type { VoiceBriefState } from '../schema';
import type { VoiceBriefConfigModule } from '../index';

export class VoiceBriefStateService {
	private $updateTail = Promise.resolve();

	constructor(readonly module: VoiceBriefConfigModule) {}

	async load() {
		const paths = await this.module.pathService.resolveVoiceBriefPaths();
		try {
			const text = await fs.readFile(paths.stateFile, 'utf-8');
			const state = yaml.load(text);
			return parseValue(VoiceBriefStateSchema, state === undefined ? {} : state);
		} catch (error) {
			if (hasErrorCode(error, 'ENOENT')) return {};
			throw error;
		}
	}

	async write(state: VoiceBriefState) {
		const paths = await this.module.pathService.resolveVoiceBriefPaths();
		await this.module.pathService.ensureVoiceBriefDirs(paths);
		await fs.writeFile(paths.stateFile, yaml.dump(state, { lineWidth: 120 }), 'utf-8');
	}

	async update<T>(operation: (state: VoiceBriefState) => Promise<T> | T): Promise<T> {
		const update = this.$updateTail.then(async () => {
			const state = await this.load();
			const result = await operation(state);
			await this.write(state);
			return result;
		});
		this.$updateTail = update.then((): undefined => undefined, (): undefined => undefined);
		return update;
	}

}

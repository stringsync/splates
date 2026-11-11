import type { DraftFiles } from "./draft-files";

/** Draft files kept nowhere: none come back after a reload. */
export class NoopDraftFiles implements DraftFiles {
	async load(): Promise<Map<string, File[]>> {
		return new Map();
	}

	save(_key: string, _files: File[]): void {}
}

import type { DraftFiles } from "./draft-files";

/**
 * Draft files kept in memory, as IndexedDB keeps them across a reload. Set
 * `hold` to make each load wait for `release`, to test files that come back
 * after the page has drawn its drafts' words, as IndexedDB's do.
 */
export class FakeDraftFiles implements DraftFiles {
	readonly kept = new Map<string, File[]>();
	hold = false;
	private readonly waiting: (() => void)[] = [];

	async load(): Promise<Map<string, File[]>> {
		if (this.hold) {
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		}
		return new Map(this.kept);
	}

	/** Lets every load held so far come back. */
	release(): void {
		for (const resolve of this.waiting.splice(0)) {
			resolve();
		}
	}

	save(key: string, files: File[]): void {
		if (files.length === 0) {
			this.kept.delete(key);
		} else {
			this.kept.set(key, files);
		}
	}
}

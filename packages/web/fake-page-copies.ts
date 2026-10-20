import type { PageCopies } from "./page-copies";

/**
 * Hand one to the page in a test, then open the page again, to see it draw
 * from what the last one kept, as it would across a reload.
 */
export class FakePageCopies implements PageCopies {
	readonly kept = new Map<string, unknown>();

	async load(key: string): Promise<unknown> {
		return structuredClone(this.kept.get(key) ?? null);
	}

	save(key: string, value: unknown): void {
		this.kept.set(key, structuredClone(value));
	}
}

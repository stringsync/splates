import type { PageCopy } from "./page-copy";

/** What a feed asks of the copy it keeps. */
export type KeptCopy<T> = Pick<PageCopy<T>, "load" | "keep" | "dispose">;

/** A `PageCopy` that keeps nothing: it has nothing to load, so the page waits for the server. */
export class NoopPageCopy<T> implements KeptCopy<T> {
	async load(): Promise<T | null> {
		return null;
	}

	keep(_value: () => T): void {}

	dispose(): void {}
}

/**
 * Share one slow read between requests that arrive together: `get` answers
 * the read kept for a key, started by `make` when none is fresh. Call `clear`
 * when what is read changes.
 */
export class KeptReads<T> {
	readonly #kept = new Map<string, { at: number; read: Promise<T> }>();
	readonly #ms: number;

	constructor(ms: number) {
		this.#ms = ms;
	}

	/** The kept read for `key` while it is fresh, else the one `make` starts. */
	get(key: string, make: () => Promise<T>): Promise<T> {
		const kept = this.#kept.get(key);
		if (kept !== undefined && Date.now() - kept.at < this.#ms) {
			return kept.read;
		}
		const read = make();
		this.#kept.set(key, { at: Date.now(), read });
		read.catch(() => this.#kept.delete(key));
		return read;
	}

	clear(): void {
		this.#kept.clear();
	}
}

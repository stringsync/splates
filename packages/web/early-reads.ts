/** Where index.html leaves the reads it starts, by the address each asks for. */
interface Early {
	splatesEarly?: Map<string, Promise<Response>>;
}

/**
 * The page's reads that index.html starts before its script has loaded, so
 * the page's first word from the server is on its way before it mounts.
 * Read through `fetch` here: the first read of an address index.html started
 * takes that one, and every other is fetched as asked.
 */
export class EarlyReads {
	constructor(private readonly early: Early = globalThis as Early) {}

	fetch(url: string): Promise<Response> {
		const started = this.early.splatesEarly?.get(url);
		if (started === undefined) {
			return fetch(url);
		}
		this.early.splatesEarly?.delete(url);
		return started;
	}
}

/** The page's own, for its feeds. */
export const EARLY_READS = new EarlyReads();

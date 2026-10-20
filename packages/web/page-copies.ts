/**
 * Where the page keeps its last copy of what the server said, so a page
 * opened again draws from it at once rather than waiting for the server.
 */
export interface PageCopies {
	/** What was last kept under `key`, or null. */
	load(key: string): Promise<unknown>;
	/** Keeps `value` under `key`, in place of what was there. */
	save(key: string, value: unknown): void;
}

const DATABASE = "splates.copies";
const STORE = "copies";

/**
 * Copies kept in IndexedDB, which clones what it keeps, so a reload gives back
 * the very value. Every failure is swallowed: the page then waits for the
 * server, as without it.
 */
export class IndexedPageCopies implements PageCopies {
	private readonly database: Promise<IDBDatabase | null>;

	constructor(factory: IDBFactory) {
		this.database = new Promise((resolve) => {
			try {
				const request = factory.open(DATABASE, 1);
				request.onupgradeneeded = () => request.result.createObjectStore(STORE);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => resolve(null);
				request.onblocked = () => resolve(null);
			} catch {
				resolve(null);
			}
		});
	}

	async load(key: string): Promise<unknown> {
		const database = await this.database;
		if (database === null) {
			return null;
		}
		return new Promise((resolve) => {
			try {
				const request = database
					.transaction(STORE, "readonly")
					.objectStore(STORE)
					.get(key);
				request.onsuccess = () => resolve(request.result ?? null);
				request.onerror = () => resolve(null);
			} catch {
				resolve(null);
			}
		});
	}

	save(key: string, value: unknown): void {
		void this.database.then((database) => {
			try {
				database
					?.transaction(STORE, "readwrite")
					.objectStore(STORE)
					.put(value, key);
			} catch {
				// Refused, as in some private windows: the next page waits for the server.
			}
		});
	}
}

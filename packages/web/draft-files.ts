/** Where the files attached to drafts are kept, since `localStorage` holds only text. */
export interface DraftFiles {
	/** Every draft's files as last saved, by the draft's key. */
	load(): Promise<Map<string, File[]>>;
	/** Keeps `files` under `key`; none drops what is kept there. */
	save(key: string, files: File[]): void;
}

const DATABASE = "splates.drafts";
const STORE = "files";

/**
 * Draft files kept in IndexedDB, which holds a `File` as it is, so a reload
 * gives back what was attached before it. Every failure is swallowed: the
 * files then live as long as the page does, as without it.
 */
export class IndexedDraftFiles implements DraftFiles {
	private readonly database: Promise<IDBDatabase | null>;

	/** `given`, or, when none is, IndexedDB's where there is one. */
	static unlessGiven(given: DraftFiles | null | undefined): DraftFiles | null {
		if (given !== undefined) {
			return given;
		}
		return typeof indexedDB === "undefined"
			? null
			: new IndexedDraftFiles(indexedDB);
	}

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

	async load(): Promise<Map<string, File[]>> {
		const loaded = new Map<string, File[]>();
		const database = await this.database;
		if (database === null) {
			return loaded;
		}
		return new Promise((resolve) => {
			try {
				const request = database
					.transaction(STORE, "readonly")
					.objectStore(STORE)
					.openCursor();
				request.onsuccess = () => {
					const cursor = request.result;
					if (cursor === null) {
						resolve(loaded);
						return;
					}
					if (typeof cursor.key === "string" && Array.isArray(cursor.value)) {
						loaded.set(cursor.key, cursor.value);
					}
					cursor.continue();
				};
				request.onerror = () => resolve(loaded);
			} catch {
				resolve(loaded);
			}
		});
	}

	save(key: string, files: File[]): void {
		void this.database.then((database) => {
			try {
				const store = database
					?.transaction(STORE, "readwrite")
					.objectStore(STORE);
				if (files.length === 0) {
					store?.delete(key);
				} else {
					store?.put(files, key);
				}
			} catch {
				// Refused, as in some private windows: the page keeps them.
			}
		});
	}
}

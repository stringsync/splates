import { dirname, relative } from "node:path";
import { Dispatcher } from "webappwiz/events";
import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Lock, type Ps } from "webappwiz/system";
import { splatesHome } from "../models";
import type { Collection } from "./collection";
import type { Document, DocumentOptions } from "./document";
import { FsCollection } from "./fs-collection";
import { FsDocument } from "./fs-document";
import { FsLog } from "./fs-log";
import { keyIn } from "./key";
import type { Log, LogOptions } from "./log";
import type { Storage, StorageChanges, Watch, WatchOptions } from "./storage";

/** What makes the lock at a path, which a worker's records take through the relay. */
export interface Locks {
	at(path: string): Lock;
}

export interface FsStorageOptions {
	/** `FileLock`s on `fs` by default. */
	locks?: Locks;
}

/**
 * Storage kept as files under `root`, each key the path of its file there,
 * so it reads and writes the very files splates kept before it had storage.
 */
/**
 * A lock's directory or what is in it. A lock sits beside what it guards, so
 * a watch on that sees every acquire and release, and a reader that takes the
 * lock would wake the watcher that called it, again and again.
 */
const LOCK_PATH = /\.lock(\/|$)/;

export class FsStorage implements Storage {
	private readonly locks: Locks;

	constructor(
		readonly root: string,
		private readonly fs: Fs,
		opts: FsStorageOptions = {},
	) {
		this.locks = opts.locks ?? { at: (path) => new FileLock(path, { fs }) };
	}

	/**
	 * The storage every project on this machine shares, under the splates
	 * home: the registry, settings, the machine's workers.
	 */
	static ofMachine({
		fs,
		ps,
		log,
		home = splatesHome(ps),
		stalenessMs,
	}: {
		fs: Fs;
		ps: Ps;
		log: Logger;
		/** The machine's home, `SPLATES_HOME` by default. */
		home?: string;
		/** After how long a lock counts as stale. */
		stalenessMs?: number;
	}): FsStorage {
		return new FsStorage(home, fs, {
			locks: {
				at: (path) => new FileLock(path, { fs, ps, log, stalenessMs }),
			},
		});
	}

	/** Where `key` is kept on disk. */
	path(key: string): string {
		return keyIn(this.root, key);
	}

	locate(key: string): string {
		return this.path(key);
	}

	async materialize(key: string): Promise<string> {
		return this.path(key);
	}

	document<T>(key: string, opts: DocumentOptions<T> = {}): Document<T> {
		return new FsDocument(
			key,
			this.path(key),
			this.fs,
			this.lock(opts.lock ?? `${key}.lock`),
			opts.schema,
		);
	}

	log<T>(key: string, opts: LogOptions<T> = {}): Log<T> {
		return new FsLog(
			key,
			this.path(key),
			this.path(opts.segments ?? `${key}.segments`),
			this.fs,
			opts.schema,
		);
	}

	collection(key: string): Collection {
		return new FsCollection(key, this.path(key), this.fs);
	}

	lock(key: string): Lock {
		const path = this.path(key);
		const lock = this.locks.at(path);
		const { fs } = this;
		// The lock sits beside what it guards, in a directory that may not be made yet.
		return {
			acquire: async () => {
				await fs.mkdir(dirname(path));
				await lock.acquire();
			},
			release: () => lock.release(),
			releaseIfOurs: () => lock.releaseIfOurs(),
		};
	}

	watch(key: string, opts: WatchOptions = {}): Watch {
		const changes = new Dispatcher<StorageChanges>();
		const watching = this.fs.watch(
			this.path(key),
			(changed) => {
				if (!LOCK_PATH.test(changed)) {
					changes.dispatch("changed", relative(this.root, changed));
				}
			},
			opts,
		);
		return {
			events: changes.events,
			dispose: () => {
				watching.dispose();
				changes.dispose();
			},
		};
	}

	async children(key: string): Promise<string[]> {
		const dir = this.path(key);
		const names = (await this.fs.readdir(dir).catch(() => [])).sort();
		const found: string[] = [];
		for (const name of names) {
			const stat = await this.fs.stat(`${dir}/${name}`).catch(() => null);
			if (stat?.isDirectory()) {
				found.push(name);
			}
		}
		return found;
	}

	async size(key: string): Promise<number> {
		return bytesUnder(this.fs, this.path(key));
	}

	async remove(key: string): Promise<void> {
		await this.fs.rm(this.path(key), { recursive: true, force: true });
	}

	within(key: string): Storage {
		return new FsStorage(this.path(key), this.fs, { locks: this.locks });
	}
}

/** The bytes of every file under `dir`, folders included; 0 when it is not there. */
async function bytesUnder(fs: Fs, dir: string): Promise<number> {
	let total = 0;
	for (const name of await fs.readdir(dir).catch(() => [])) {
		const path = `${dir}/${name}`;
		const stat = await fs.stat(path).catch(() => null);
		if (stat === null) {
			continue;
		}
		total += stat.isDirectory() ? await bytesUnder(fs, path) : stat.size;
	}
	return total;
}

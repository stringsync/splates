import { relative } from "node:path";
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
	}: {
		fs: Fs;
		ps: Ps;
		log: Logger;
	}): FsStorage {
		return new FsStorage(splatesHome(ps), fs, {
			locks: { at: (path) => new FileLock(path, { fs, ps, log }) },
		});
	}

	/** Where `key` is kept on disk. */
	path(key: string): string {
		return keyIn(this.root, key);
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
		return this.locks.at(this.path(key));
	}

	watch(key: string, opts: WatchOptions = {}): Watch {
		const changes = new Dispatcher<StorageChanges>();
		const watching = this.fs.watch(
			this.path(key),
			(changed) => changes.dispatch("changed", relative(this.root, changed)),
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

	within(key: string): Storage {
		return new FsStorage(this.path(key), this.fs, { locks: this.locks });
	}
}

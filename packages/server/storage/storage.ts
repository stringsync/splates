import type { Resource } from "webappwiz/disposable";
import type { Eventful } from "webappwiz/events";
import type { Lock } from "webappwiz/system";
import type { Collection } from "./collection";
import type { Document, DocumentOptions } from "./document";
import type { Log, LogOptions } from "./log";

/**
 * Where splates keeps its state, as a few kinds of thing rather than files,
 * so a database or a cloud store can stand in for the disk. Every key is a
 * `/`-separated path relative to the storage, extension included, so the
 * file-system one keeps each thing in the file a store kept it in before.
 */
export interface Storage {
	/** One whole value, read and written at once. */
	document<T>(key: string, opts?: DocumentOptions<T>): Document<T>;
	/** Entries only ever added to, read back in the order they came. */
	log<T>(key: string, opts?: LogOptions<T>): Log<T>;
	/** Records and blobs kept by name, as a store of one per task keeps them. */
	collection(key: string): Collection;
	/**
	 * The mutex every holder of `key` shares, across processes and, on a
	 * worker, across machines.
	 */
	lock(key: string): Lock;
	/**
	 * Tells of each change at `key` or directly under it, as a write or a
	 * removal, until disposed. Throws when the storage cannot watch `key`, as
	 * the disk cannot a directory not yet made, so callers can say what they
	 * will miss.
	 */
	watch(key: string, opts?: WatchOptions): Watch;
	/**
	 * The path `key` can be opened at as a file, which is what an agent is
	 * handed to read an attachment; a storage with no files gives a path no
	 * file is at.
	 */
	locate(key: string): string;
	/**
	 * A path on this machine where what is kept at `key`, a record, a blob or
	 * a log, opens as a file, for an agent to read: where the disk keeps it,
	 * or a copy a storage with no files writes to a local cache first.
	 */
	materialize(key: string): Promise<string>;
	/** The names directly under `key` that hold more keys of their own, sorted. */
	children(key: string): Promise<string[]>;
	/** The bytes everything under `key`, nested keys included, takes. */
	size(key: string): Promise<number>;
	/**
	 * Every key under `key`, nested ones included, that holds something
	 * itself: a document, a record or blob, or a log or one of its segments.
	 * Sorted, relative to the storage, and never a lock.
	 */
	keys(key: string): Promise<string[]>;
	/**
	 * What `key` holds itself, as a copy kept elsewhere needs it: a value's
	 * bytes, or a log's whole lines after the first `from`, with how many it
	 * has. Null when it holds nothing.
	 */
	copy(key: string, from?: number): Promise<Kept | null>;
	/** Removes everything under `key`, nested keys included; nothing there is no error. */
	remove(key: string): Promise<void>;
	/** The storage under `key`, which its own keys are relative to. */
	within(key: string): Storage;
}

/** What `Storage.copy` reads at a key. */
export type Kept =
	| { kind: "value"; bytes: Uint8Array }
	| {
			kind: "log";
			/** The lines after the ones skipped, each without its newline. */
			lines: string[];
			/** How many lines the log has, those skipped included. */
			count: number;
	  };

export interface WatchOptions {
	/** Everything under `key` too, rather than what is directly under it. */
	recursive?: boolean;
}

/** What `Storage.watch` tells of. */
export interface StorageChanges extends Record<string, unknown> {
	/** The key that changed, relative to the storage watched. */
	changed: string;
}

/** A watch on a storage's keys, which stops once disposed. */
export interface Watch extends Eventful<StorageChanges>, Resource {}

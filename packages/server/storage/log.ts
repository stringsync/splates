import type { Schema } from "./schema";

/**
 * Entries a store keeps in order: `append` to it, even from two writers at
 * once, `replay` it, `rotate` it once full, and `compact` it once its entries
 * fold into fewer.
 */
export interface Log<T> {
	readonly key: string;
	/**
	 * Whether anything was appended since the log was made, last rotated or
	 * removed, without reading it.
	 */
	exists(): Promise<boolean>;
	/** Adds `entries` at the end, in one write. */
	append(...entries: T[]): Promise<void>;
	/**
	 * The entries since the last rotation, oldest first. A torn or unreadable
	 * entry is left out, so it loses one entry rather than the log, and the
	 * next append keeps clear of it.
	 */
	replay(): Promise<T[]>;
	/** The first entry since the last rotation, as `replay` reads it, without reading the rest; null for none. */
	first(): Promise<T | null>;
	/**
	 * Rewrites the entries since the last rotation as `merge` folds them into
	 * fewer, in one write, for entries that say no more than fewer would:
	 * those appended meanwhile stay after them. Nothing changes when `merge`
	 * returns as many as it was given.
	 */
	compact(merge: (entries: T[]) => T[]): Promise<void>;
	/**
	 * Moves the entries since the last rotation aside as a segment, returning
	 * it, or null when there were none. Two rotating at once is harmless: the
	 * second moves nothing, or the few entries written since.
	 */
	rotate(): Promise<Segment | null>;
	/** The segments rotated out, oldest first. */
	segments(): Promise<Segment[]>;
	/** The entries of one segment, as `replay` reads them. */
	replaySegment(segment: Segment): Promise<T[]>;
	dropSegment(segment: Segment): Promise<void>;
	/** Removes the log and every segment of it. */
	remove(): Promise<void>;
}

/** Entries rotated out of a log together. */
export interface Segment {
	/** Unique within its log, and sorting by when it was rotated. */
	name: string;
	/** When it was rotated, as epoch ms. */
	at: number;
}

export interface LogOptions<T> {
	/** Checks each entry read, throwing on one that is not a `T`. */
	schema?: Schema<T>;
	/**
	 * The key its segments are kept under, as the journal keeps its in `log`;
	 * `<key>.segments` by default.
	 */
	segments?: string;
}

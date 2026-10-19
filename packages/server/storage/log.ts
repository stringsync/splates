import type { Schema } from "./schema";

/**
 * Entries appended and never rewritten, so two writers at once both keep
 * theirs. A full log is rotated: its entries move aside as a segment, which
 * is read back on its own and dropped once old.
 */
export interface Log<T> {
	readonly key: string;
	/** Adds `entries` at the end, in one write. */
	append(...entries: T[]): Promise<void>;
	/**
	 * The entries since the last rotation, oldest first. A torn or unreadable
	 * entry is left out, so it loses one entry rather than the log.
	 */
	replay(): Promise<T[]>;
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

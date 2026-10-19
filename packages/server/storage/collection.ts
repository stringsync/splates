/**
 * Records and blobs kept by name, flat: a record is text, as a task's
 * markdown, and a blob is bytes, as an attached file. A name holds one or
 * the other, and never a `/`; what nests goes in a collection of its own.
 */
export interface Collection {
	readonly key: string;
	/** The record under `name`, or null when there is none. */
	read(name: string): Promise<string | null>;
	/** Keeps `text` under `name`; a reader never sees it half written. */
	write(name: string, text: string): Promise<void>;
	readBytes(name: string): Promise<Uint8Array | null>;
	writeBytes(name: string, bytes: Uint8Array): Promise<void>;
	/** Every name held, sorted. */
	list(): Promise<string[]>;
	/** Removes what is under `name`; nothing there is no error. */
	remove(name: string): Promise<void>;
	/** Removes everything held. */
	clear(): Promise<void>;
	/** The bytes everything held takes, for a quota. */
	size(): Promise<number>;
}

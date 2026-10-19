import type { Schema } from "./schema";

/**
 * One value kept whole, as JSON: a settings file, a registry. A reader never
 * sees a write half done.
 */
export interface Document<T> {
	readonly key: string;
	/** The value, or null when none was ever written or it was removed. */
	read(): Promise<T | null>;
	write(value: T): Promise<void>;
	/**
	 * Writes what `edit` makes of the value, holding the document's lock, so
	 * two processes updating at once each build on the other's write.
	 */
	update(edit: (current: T | null) => T | Promise<T>): Promise<T>;
	remove(): Promise<void>;
}

export interface DocumentOptions<T> {
	/**
	 * Checks what is read, throwing on a value that is not a `T`; by default
	 * it is trusted as one.
	 */
	schema?: Schema<T>;
	/** The lock `update` holds; `<key>.lock` by default. */
	lock?: string;
}

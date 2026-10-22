import { createHash } from "node:crypto";

/**
 * Where a copy of a project's records goes: an object store kept by key, as
 * a bucket keeps one, so any S3-compatible service or a folder can be one.
 * Keys are `/`-separated paths, as storage keys are. What the records are,
 * and how they map onto keys, is the `Replicator`'s; a replica only keeps
 * bytes.
 */
export interface Replica {
	/** Where it is, for a person to read, as `s3://records/splates`. */
	readonly name: string;
	/** Keeps `bytes` at `key`, replacing what was there. */
	put(key: string, bytes: Uint8Array): Promise<void>;
	/** What is kept at `key`, or null when nothing is. */
	get(key: string): Promise<Uint8Array | null>;
	/**
	 * Everything kept under `key`, nested keys included, sorted by key; the
	 * whole replica under `""`.
	 */
	list(key: string): Promise<ReplicaObject[]>;
	/** Removes what is at `key`; nothing there is no error. */
	delete(key: string): Promise<void>;
}

/** One thing a replica keeps, as its listing tells of it. */
export interface ReplicaObject {
	key: string;
	size: number;
	/** The MD5 of its bytes, as hex: what an S3 listing gives as its ETag. */
	md5: string;
}

/** The MD5 of `bytes` as hex, as a replica lists it. */
export function md5(bytes: Uint8Array): string {
	return createHash("md5").update(bytes).digest("hex");
}

/** Orders objects by key, as a listing gives them. */
export function byKey(left: { key: string }, right: { key: string }): number {
	return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

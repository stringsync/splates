import { sha256 } from "./aws-sign";

/**
 * Where the `Replicator` keeps each kind of thing in a replica, keyed by the
 * storage key it copies, so a replica restores into any engine: a value
 * whole at `values/<key>`, a log as chunks of lines at
 * `logs/<key>/<to>-<hash>.jsonl`, each holding the lines up to line `to`
 * from the one before, `hash` naming its last line, and `manifest.json`.
 */
export const MANIFEST = "manifest.json";

/** What a replica's `manifest.json` says of it. */
export interface Manifest {
	version: 1;
	/** The server whose records these are, which only it replicates into. */
	origin: string;
	/** The machine that last caught it up, for a person to read. */
	host: string;
	/** When it last held every change, epoch ms; null before it first has. */
	caughtUpAt: number | null;
}

/** One chunk of a log as kept in a replica. */
export interface Chunk {
	/** Its key in the replica. */
	key: string;
	/** How many of the log's lines it and the chunks before it hold. */
	to: number;
	/** The hash of its last line, which tells whether the log still begins with what was shipped. */
	last: string;
}

export function valueKey(key: string): string {
	return `values/${key}`;
}

export function chunkKey(key: string, to: number, last: string): string {
	return `logs/${key}/${String(to).padStart(10, "0")}-${last}.jsonl`;
}

/** The short hash a chunk's key names its last line by. */
export function lineHash(line: string): string {
	return sha256(line).slice(0, 12);
}

/**
 * What a replica's listing holds, as the storage keys it copies: each
 * value's MD5 and each log's chunks, oldest first.
 */
export function readListing(keys: { key: string; md5: string }[]): {
	values: Map<string, string>;
	logs: Map<string, Chunk[]>;
} {
	const values = new Map<string, string>();
	const logs = new Map<string, Chunk[]>();
	for (const { key, md5 } of keys) {
		if (key.startsWith("values/")) {
			values.set(key.slice("values/".length), md5);
			continue;
		}
		const chunk = key.match(/^logs\/(.+)\/(\d{10})-([0-9a-f]{12})\.jsonl$/);
		if (chunk?.[1] === undefined) {
			continue;
		}
		const chunks = logs.get(chunk[1]) ?? [];
		chunks.push({ key, to: Number(chunk[2]), last: chunk[3] ?? "" });
		logs.set(chunk[1], chunks);
	}
	for (const chunks of logs.values()) {
		chunks.sort((left, right) => left.to - right.to);
	}
	return { values, logs };
}

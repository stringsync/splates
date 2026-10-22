import type { Fs } from "webappwiz/system";
import type { Storage } from "../storage";
import { replace } from "../storage";
import { readListing, readManifest } from "./layout";
import type { Replica } from "./replica";
import { Replicator } from "./replicator";
import { replicated } from "./shipped";

/** The project's records, as a restore needs them; a `ProjectHome` is one. */
export interface RestoreTarget {
	dir(): Promise<string>;
	exists(): Promise<boolean>;
	open(): Promise<Storage>;
	dispose(): void;
	/** Copies the files under `dir` in, stamping the database with `format`. */
	import(dir: string, format: number): Promise<void>;
	/** Leaves the database there is aside; returns where. */
	moveAside(to: string): Promise<string>;
	clearMoved(): Promise<void>;
}

/** What a restore brought. */
export interface Restored {
	/** How many values and logs it wrote. */
	values: number;
	logs: number;
	/** The machine that last caught the replica up. */
	host: string;
	/** Where the records it replaced went, when it replaced some. */
	replaced: string | null;
}

/**
 * Rebuilds a project's records from `replica` into `target`: each value
 * whole and each log its chunks joined in order, written as the files the
 * records were once kept as and imported into a database made beside the
 * live one and renamed into place, so a restore that fails leaves nothing
 * half done. Records already there stop it unless `force`, which leaves
 * them aside. The database then adopts the replica's origin, so a server
 * started on it replicates on into the same replica.
 */
export async function restoreFromReplica(
	replica: Replica,
	{
		target,
		fs,
		format,
		force,
	}: { target: RestoreTarget; fs: Fs; format: number; force: boolean },
): Promise<Restored> {
	const manifest = await readManifest(replica);
	if (manifest === null) {
		throw new Error(`nothing to restore: ${replica.name} holds no records yet`);
	}
	const present = await target.exists();
	if (present && !force) {
		throw new Error(
			"this project already has records here: restore over them with --force, which leaves them aside",
		);
	}
	const listing = readListing(await replica.list(""));
	const stamp = listing.values.has("format")
		? Number(new TextDecoder().decode(await need(replica, "values/format")))
		: format;
	if (stamp > format) {
		throw new Error(
			`the replica's records are in format ${stamp}, newer than this splates's ${format}: update splates first`,
		);
	}
	const staging = `${await target.dir()}/restoring.tmp`;
	await fs.rm(staging, { recursive: true, force: true });
	await fs.mkdir(staging, { recursive: true });
	try {
		let values = 0;
		let logs = 0;
		for (const key of listing.values.keys()) {
			if (!replicated(key)) {
				continue;
			}
			await replace(
				fs,
				`${staging}/${key}`,
				await need(replica, `values/${key}`),
			);
			values++;
		}
		for (const [key, chunks] of listing.logs) {
			if (!replicated(key)) {
				continue;
			}
			const parts: Uint8Array[] = [];
			for (const chunk of chunks) {
				parts.push(await need(replica, chunk.key));
			}
			await replace(fs, `${staging}/${key}`, join(parts));
			logs++;
		}
		const replaced = present
			? await target.moveAside(`the replica ${replica.name}, restored here`)
			: null;
		await target.import(staging, stamp);
		await target.clearMoved();
		await Replicator.adopt(await target.open(), manifest.origin);
		return { values, logs, host: manifest.host, replaced };
	} finally {
		target.dispose();
		await fs.rm(staging, { recursive: true, force: true });
	}
}

async function need(replica: Replica, key: string): Promise<Uint8Array> {
	const bytes = await replica.get(key);
	if (bytes === null) {
		throw new Error(`${replica.name} lists ${key} but no longer holds it`);
	}
	return bytes;
}

/** The chunks of a log end in a newline each, so their bytes join as they are. */
function join(parts: Uint8Array[]): Uint8Array {
	const whole = new Uint8Array(
		parts.reduce((sum, part) => sum + part.length, 0),
	);
	let at = 0;
	for (const part of parts) {
		whole.set(part, at);
		at += part.length;
	}
	return whole;
}

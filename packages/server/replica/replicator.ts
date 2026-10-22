import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Duration, type Timer, type WallClock } from "webappwiz/time";
import { z } from "zod";
import { limited } from "../limited";
import type { Kept, Storage, Watch } from "../storage";
import {
	type Chunk,
	chunkKey,
	lineHash,
	MANIFEST,
	type Manifest,
	readListing,
	valueKey,
} from "./layout";
import { md5, type Replica } from "./replica";
import { replicated } from "./shipped";
import type { ReplicaStatus } from "./status";

export interface ReplicatorOptions {
	/** The project's records, every key of which is copied but those `replicated` keeps back. */
	storage: Storage;
	replica: Replica;
	timer: Timer;
	clock: WallClock;
	log: Logger;
	/** This machine's name, for the manifest. */
	host: string;
	/** How long changes gather before they are shipped together. */
	batch?: Duration;
	/** The longest a failed batch waits before it is tried again. */
	maxRetry?: Duration;
}

/**
 * Keeps a replica a copy of a project's storage: it watches every key, so it
 * hears a CLI process's writes as well as the server's, gathers the changes
 * of a few seconds, and ships each changed key as it now stands, a value
 * whole and a log's new lines as a chunk. On `start` it catches up with
 * whatever changed while it was not running by comparing the replica's
 * listing with the storage. It replicates only into a replica it began, or
 * an empty one, so two servers never write over each other's records.
 */
export class Replicator implements Resource {
	private readonly batch: Duration;
	private readonly maxRetry: Duration;
	/** Each value's MD5 as the replica holds it, by storage key. */
	private values = new Map<string, string>();
	/** Each log's chunks as the replica holds them, oldest first, by storage key. */
	private logs = new Map<string, Chunk[]>();
	/** The keys changed since they were last shipped. */
	private readonly pending = new Set<string>();
	private behindSince: number | null = null;
	private caughtUpAt: number | null = null;
	private error: string | null = null;
	private origin: string | null = null;
	private failures = 0;
	private watch: Watch | null = null;
	private scheduled: Resource | null = null;
	private flushing: Promise<void> | null = null;
	private stopped = false;
	/** The status last recorded, as JSON. */
	private recordedAs = "";
	/** Whether this run has written the manifest yet. */
	private claimed = false;

	constructor(private readonly opts: ReplicatorOptions) {
		this.batch = opts.batch ?? Duration.secs(3);
		this.maxRetry = opts.maxRetry ?? Duration.mins(5);
	}

	/**
	 * Takes the replica as this server's, or refuses one another server
	 * began, then ships everything that differs and watches for more. A
	 * replica it cannot reach is tried again later, as a failed batch is.
	 */
	async start(): Promise<void> {
		this.watch = this.opts.storage.watch("", { recursive: true });
		this.watch.events.on("changed", (key) => this.changed(key));
		await this.flush();
	}

	status(): ReplicaStatus {
		return {
			replica: this.opts.replica.name,
			caughtUpAt: this.caughtUpAt,
			pending: this.pending.size,
			behindSince: this.behindSince,
			error: this.error,
		};
	}

	/** Where the replicator of `storage` last said its replica stood, or null when none has run. */
	static async recorded(storage: Storage): Promise<ReplicaStatus | null> {
		const record = await storage
			.document(RECORD_KEY, { schema: RECORD })
			.read();
		return record?.status ?? null;
	}

	/** Ships what has changed now, rather than when the batch is due; done once it is. */
	async flush(): Promise<void> {
		while (this.flushing !== null) {
			await this.flushing;
		}
		this.scheduled?.dispose();
		this.scheduled = null;
		this.flushing = this.run().finally(() => {
			this.flushing = null;
		});
		await this.flushing;
	}

	/** Catches up first when it has yet to, then ships what is pending. */
	private async run(): Promise<void> {
		if (this.origin === null && !(await this.catchUp())) {
			await this.record();
			return;
		}
		await this.ship();
		await this.record();
	}

	dispose(): void {
		this.stopped = true;
		this.watch?.dispose();
		this.scheduled?.dispose();
	}

	private changed(key: string): void {
		if (!replicated(key)) {
			return;
		}
		this.pending.add(key);
		this.behindSince ??= this.opts.clock.now();
		// Until it has caught up, `start` or a retry ships everything anyway.
		if (this.origin !== null) {
			this.schedule(this.batch);
		}
	}

	private schedule(after: Duration): void {
		if (this.scheduled !== null || this.stopped) {
			return;
		}
		this.scheduled = this.opts.timer.setTimeout(() => {
			this.scheduled = null;
			void this.flush();
		}, after);
	}

	/**
	 * Reads the manifest and listing, settles whose replica it is, and marks
	 * every key on either side to be shipped, which ships only what differs.
	 * False when it cannot replicate yet.
	 */
	private async catchUp(): Promise<boolean> {
		const { storage, replica } = this.opts;
		try {
			const manifest = await this.manifest();
			const origin = await this.ownOrigin();
			if (manifest !== null && manifest.origin !== origin) {
				this.error = `${replica.name} holds the records of another server, last caught up on ${manifest.host}: restore from it, or give this project's replica its own prefix`;
				this.opts.log.error(this.error);
				return false;
			}
			const listing = readListing(await replica.list(""));
			this.values = listing.values;
			this.logs = listing.logs;
			this.origin = origin;
			this.caughtUpAt = manifest?.caughtUpAt ?? null;
			const keys = new Set([
				...(await storage.keys("")),
				...this.values.keys(),
				...this.logs.keys(),
			]);
			for (const key of keys) {
				if (replicated(key)) {
					this.pending.add(key);
				}
			}
			this.behindSince ??= this.opts.clock.now();
		} catch (error) {
			this.failed(error);
			return false;
		}
		return true;
	}

	/** Ships each pending key, then the manifest, leaving any that failed to be tried again. */
	private async ship(): Promise<void> {
		const keys = [...this.pending].sort();
		this.pending.clear();
		const startedAt = this.opts.clock.now();
		const failed: unknown[] = [];
		await limited(keys, CONCURRENCY, async (key) => {
			try {
				await this.shipKey(key);
			} catch (error) {
				failed.push(error);
				this.pending.add(key);
			}
		});
		// The first batch writes the manifest even with nothing to ship, to take the replica.
		if (failed.length === 0 && (keys.length > 0 || !this.claimed)) {
			try {
				await this.writeManifest(this.pending.size === 0 ? startedAt : null);
			} catch (error) {
				failed.push(error);
			}
		}
		if (failed.length > 0) {
			this.failed(failed[0]);
			return;
		}
		this.failures = 0;
		this.error = null;
		if (this.pending.size === 0) {
			this.behindSince = null;
		} else {
			this.schedule(this.batch);
		}
	}

	/** Makes the replica hold what `key` holds now, or nothing when it holds nothing. */
	private async shipKey(key: string): Promise<void> {
		const { storage, replica } = this.opts;
		const chunks = this.logs.get(key) ?? [];
		const last = chunks.at(-1);
		const kept = await storage.copy(key, last === undefined ? 0 : last.to - 1);
		if (kept?.kind !== "value" && this.values.has(key)) {
			await replica.delete(valueKey(key));
			this.values.delete(key);
		}
		if (kept?.kind !== "log" && chunks.length > 0) {
			await this.dropChunks(key);
		}
		if (kept?.kind === "value") {
			const hash = md5(kept.bytes);
			if (this.values.get(key) !== hash) {
				await replica.put(valueKey(key), kept.bytes);
				this.values.set(key, hash);
			}
		} else if (kept?.kind === "log") {
			await this.shipLines(key, kept, last);
		}
	}

	/**
	 * Ships a log's lines since its last chunk as one more chunk, or, when
	 * it no longer begins with what was shipped, as a rotation leaves it,
	 * all of them again in place of the chunks there were.
	 */
	private async shipLines(
		key: string,
		kept: Extract<Kept, { kind: "log" }>,
		last: Chunk | undefined,
	): Promise<void> {
		let lines = kept.lines;
		let from = 0;
		if (last !== undefined) {
			const [overlap, ...after] = kept.lines;
			if (
				kept.count >= last.to &&
				overlap !== undefined &&
				lineHash(overlap) === last.last
			) {
				lines = after;
				from = last.to;
			} else {
				await this.dropChunks(key);
				const again = await this.opts.storage.copy(key);
				lines = again?.kind === "log" ? again.lines : [];
			}
		}
		const final = lines.at(-1);
		if (final === undefined) {
			return;
		}
		const chunk = {
			key: chunkKey(key, from + lines.length, lineHash(final)),
			to: from + lines.length,
			last: lineHash(final),
		};
		await this.opts.replica.put(
			chunk.key,
			new TextEncoder().encode(lines.map((line) => `${line}\n`).join("")),
		);
		this.logs.set(key, [...(this.logs.get(key) ?? []), chunk]);
	}

	private async dropChunks(key: string): Promise<void> {
		for (const chunk of this.logs.get(key) ?? []) {
			await this.opts.replica.delete(chunk.key);
		}
		this.logs.delete(key);
	}

	private async manifest(): Promise<Manifest | null> {
		const bytes = await this.opts.replica.get(MANIFEST);
		if (bytes === null) {
			return null;
		}
		const parsed = MANIFEST_SCHEMA.safeParse(
			JSON.parse(new TextDecoder().decode(bytes)),
		);
		if (!parsed.success) {
			throw new Error(
				`${this.opts.replica.name} has a ${MANIFEST} splates cannot read`,
			);
		}
		return parsed.data;
	}

	/** Writes the manifest, saying it caught up at `at` when given. */
	private async writeManifest(at: number | null): Promise<void> {
		if (at !== null) {
			this.caughtUpAt = at;
		}
		const manifest: Manifest = {
			version: 1,
			origin: this.origin ?? "",
			host: this.opts.host,
			caughtUpAt: this.caughtUpAt,
		};
		await this.opts.replica.put(
			MANIFEST,
			new TextEncoder().encode(`${JSON.stringify(manifest, null, "\t")}\n`),
		);
		this.claimed = true;
	}

	/** The id this server's replicas are begun with, made the first time. */
	private async ownOrigin(): Promise<string> {
		const kept = await this.opts.storage
			.document(RECORD_KEY, { schema: RECORD })
			.update((current) => current ?? { origin: crypto.randomUUID() });
		return kept.origin;
	}

	/** Records the status beside the origin when it changed since last recorded. */
	private async record(): Promise<void> {
		const status = this.status();
		const text = JSON.stringify(status);
		if (text === this.recordedAs) {
			return;
		}
		this.recordedAs = text;
		try {
			await this.opts.storage
				.document(RECORD_KEY, { schema: RECORD })
				.update((current) => ({
					origin: current?.origin ?? this.origin ?? crypto.randomUUID(),
					status,
				}));
		} catch (error) {
			this.recordedAs = "";
			this.opts.log.error(`replica status not recorded: ${error}`);
		}
	}

	/** Records why the batch failed and tries again later, waiting longer each time. */
	private failed(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		if (message !== this.error) {
			this.opts.log.error(`replica ${this.opts.replica.name}: ${message}`);
		}
		this.error = message;
		this.failures++;
		const wait = Math.min(this.batch.ms * 2 ** this.failures, this.maxRetry.ms);
		this.schedule(Duration.ms(wait));
	}
}

/**
 * The key in the project's storage naming it as a replica's origin, with
 * where the replica last stood, which no replica carries.
 */
const RECORD_KEY = "replica.json";

const STATUS = z.object({
	replica: z.string(),
	caughtUpAt: z.number().nullable(),
	pending: z.number(),
	behindSince: z.number().nullable(),
	error: z.string().nullable(),
});

const RECORD = z.object({
	origin: z.string(),
	/** As of the last batch, for `splates replica` to read with the server stopped or elsewhere. */
	status: STATUS.optional(),
});

const MANIFEST_SCHEMA = z.object({
	version: z.literal(1),
	origin: z.string(),
	host: z.string(),
	caughtUpAt: z.number().nullable(),
});

/** How many keys are shipped at once. */
const CONCURRENCY = 8;

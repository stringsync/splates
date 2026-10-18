import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Fs } from "webappwiz/system";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { z } from "zod";

/** How long a join token lets a machine join, once. */
export const JOIN_WITHIN = Duration.mins(15);

const Record = z.object({
	id: z.string(),
	/** The sha256 of the key it joined with; null for the local worker, which joins over its socket. */
	key: z.string().nullable(),
	/** When it joined; null for the local worker. */
	joinedAt: z.string().nullable(),
	/** How many agents it runs at once, over what its hello says; null to go by its hello. */
	slots: z.number().int().min(1).nullable(),
	/** Takes no new agents while true. */
	draining: z.boolean(),
	/** Is removed once its last agent ends. */
	removing: z.boolean(),
	/** What its provider made it as, for one splates made; null for one that joined by hand. */
	provisioned: z
		.object({ type: z.string(), dollarsPerHour: z.number() })
		.nullable()
		.default(null),
});

/** What the coordinator keeps of one worker across restarts. */
export type WorkerRecord = z.infer<typeof Record>;

const Kept = z.object({
	workers: z.array(Record).default([]),
	/** Join tokens not yet used, by their sha256, with when each runs out. */
	joins: z
		.array(z.object({ hash: z.string(), expiresAt: z.number() }))
		.default([]),
});

type KeptFile = z.infer<typeof Kept>;

/** What may be changed of a worker by hand. */
export type WorkerSettings = Partial<
	Pick<WorkerRecord, "slots" | "draining" | "removing" | "provisioned">
>;

/**
 * The workers the coordinator has let join, with what was set on each, kept
 * at `path` so a restart forgets none. A worker joins once with a join
 * token, single use and good for `JOIN_WITHIN`, and is answered a key of its
 * own, which it shows on every connection after. Only each key's and
 * token's sha256 is kept: both are 32 random bytes, so a hash cannot be
 * turned back, and the file lets no one in.
 */
export class WorkerRecords {
	/** Serializes writes, so two changes never race to the file. */
	private writing: Promise<void> = Promise.resolve();

	private constructor(
		private readonly path: string | null,
		private readonly fs: Fs | null,
		private readonly wall: WallClock,
		private kept: KeptFile,
	) {}

	/** Reads what `path` keeps, or starts empty when it keeps nothing readable. */
	static async open(
		path: string,
		fs: Fs,
		wall: WallClock = new SystemWallClock(),
	): Promise<WorkerRecords> {
		const read = await fs.read(path).catch(() => null);
		let kept: KeptFile = { workers: [], joins: [] };
		if (read !== null) {
			try {
				kept = Kept.parse(JSON.parse(read));
			} catch {
				// Unreadable: no worker joined, so each joins again.
			}
		}
		return new WorkerRecords(path, fs, wall, kept);
	}

	/** Records kept in memory alone, for a coordinator that keeps nothing. */
	static memory(wall: WallClock = new SystemWallClock()): WorkerRecords {
		return new WorkerRecords(null, null, wall, { workers: [], joins: [] });
	}

	get all(): WorkerRecord[] {
		return [...this.kept.workers];
	}

	of(id: string): WorkerRecord | undefined {
		return this.kept.workers.find((each) => each.id === id);
	}

	/** A new join token, and when it runs out. */
	async invite(): Promise<{ token: string; expiresAt: number }> {
		const token = `splj_${secret()}`;
		const expiresAt = this.wall.now() + JOIN_WITHIN.ms;
		await this.change((kept) => ({
			...kept,
			joins: [...this.live(kept), { hash: sha256(token), expiresAt }],
		}));
		return { token, expiresAt };
	}

	/**
	 * Spends `token` to let worker `id` join, answering the key it connects
	 * with from now on, or null for a token unknown, spent or run out. A
	 * worker joining again under its id gets a new key, which revokes the
	 * old.
	 */
	async join(token: string, id: string): Promise<string | null> {
		const hash = sha256(token);
		const live = this.live(this.kept);
		if (!live.some((each) => same(each.hash, hash))) {
			return null;
		}
		const key = secret();
		const was = this.of(id);
		const record: WorkerRecord = {
			id,
			key: sha256(key),
			joinedAt: new Date(this.wall.now()).toISOString(),
			slots: was?.slots ?? null,
			draining: false,
			removing: false,
			provisioned: was?.provisioned ?? null,
		};
		await this.change((kept) => ({
			workers: [...kept.workers.filter((each) => each.id !== id), record],
			joins: this.live(kept).filter((each) => !same(each.hash, hash)),
		}));
		return key;
	}

	/** Whether `key` is the one worker `id` joined with. */
	verify(id: string, key: string): boolean {
		const kept = this.of(id)?.key;
		return kept !== undefined && kept !== null && same(kept, sha256(key));
	}

	/** Changes what is set on worker `id`, keeping a record for it if it had none. */
	async set(id: string, settings: WorkerSettings): Promise<WorkerRecord> {
		const record: WorkerRecord = {
			...(this.of(id) ?? {
				id,
				key: null,
				joinedAt: null,
				slots: null,
				draining: false,
				removing: false,
				provisioned: null,
			}),
			...settings,
		};
		await this.change((kept) => ({
			...kept,
			workers: [...kept.workers.filter((each) => each.id !== id), record],
		}));
		return record;
	}

	/** Forgets worker `id`, revoking its key; answers whether it was kept. */
	async remove(id: string): Promise<boolean> {
		if (this.of(id) === undefined) {
			return false;
		}
		await this.change((kept) => ({
			...kept,
			workers: kept.workers.filter((each) => each.id !== id),
		}));
		return true;
	}

	private live(kept: KeptFile): KeptFile["joins"] {
		const now = this.wall.now();
		return kept.joins.filter((each) => each.expiresAt > now);
	}

	private change(next: (kept: KeptFile) => KeptFile): Promise<void> {
		this.kept = next(this.kept);
		const path = this.path;
		const fs = this.fs;
		if (path === null || fs === null) {
			return Promise.resolve();
		}
		const text = `${JSON.stringify(this.kept)}\n`;
		this.writing = this.writing
			.catch(() => {})
			.then(async () => {
				await fs.mkdir(path.slice(0, path.lastIndexOf("/")));
				await fs.write(path, text);
			});
		return this.writing;
	}
}

/** 32 random bytes, as base64url. */
function secret(): string {
	return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Whether two hashes are the same, in time that says nothing of where they differ. */
function same(one: string, other: string): boolean {
	const first = Buffer.from(one, "hex");
	const second = Buffer.from(other, "hex");
	return first.length === second.length && timingSafeEqual(first, second);
}

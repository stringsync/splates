import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { z } from "zod";
import type { Document } from "../storage";
import { joinToken, type ServiceToken } from "./access";

/** How long a join token lets a machine join, once. */
export const JOIN_WITHIN = Duration.mins(15);

/** What the coordinator keeps of one worker across restarts. */
export type WorkerRecord = z.output<typeof Record>;

/** What may be changed of a worker by hand. */
export type WorkerSettings = Partial<
	Pick<
		WorkerRecord,
		| "slots"
		| "draining"
		| "removing"
		| "updating"
		| "provisioned"
		| "wake"
		| "wokenAt"
	>
>;

/**
 * The workers the coordinator has let join, with what was set on each, kept
 * at `path` so a restart forgets none. `invite` makes a join token, single
 * use and good for `JOIN_WITHIN`; `join` spends it, answering the key the
 * worker shows on every connection after, which `verify` checks.
 */
export class WorkerRecords {
	// Only each key's and token's sha256 is kept: both are 32 random bytes,
	// so a hash cannot be turned back, and the file lets no one in.
	/** Serializes writes, so two changes never race to the file. */
	private writing: Promise<void> = Promise.resolve();

	private constructor(
		private readonly document: Document<KeptFile> | null,
		private readonly wall: WallClock,
		private kept: KeptFile,
	) {}

	/** Reads what `document` keeps, or starts empty when it keeps nothing readable. */
	static async open(
		document: Document<KeptFile>,
		wall: WallClock = new SystemWallClock(),
	): Promise<WorkerRecords> {
		let kept: KeptFile = { workers: [], joins: [], local: true };
		try {
			const read = await document.read();
			if (read !== null) {
				kept = Kept.parse(read);
			}
		} catch {
			// Unreadable: no worker joined, so each joins again.
		}
		return new WorkerRecords(document, wall, kept);
	}

	/** Records kept in memory alone, for a coordinator that keeps nothing. */
	static memory(wall: WallClock = new SystemWallClock()): WorkerRecords {
		return new WorkerRecords(null, wall, {
			workers: [],
			joins: [],
			local: true,
		});
	}

	get all(): WorkerRecord[] {
		return [...this.kept.workers];
	}

	of(id: string): WorkerRecord | undefined {
		return this.kept.workers.find((each) => each.id === id);
	}

	/**
	 * Whether this machine's own worker runs agents. Removing it keeps its
	 * process, which the page's shells and task ports run on, but takes it
	 * out of the pool until it is turned on again.
	 */
	get localOn(): boolean {
		return this.kept.local;
	}

	/** Turns this machine's own worker on or off, keeping what was set on it. */
	async turnLocal(on: boolean): Promise<void> {
		await this.change((kept) => ({ ...kept, local: on }));
	}

	/**
	 * A new join token, and when it runs out. Given `access`, the service
	 * token minted for it, the join token carries its client id and secret
	 * for the worker to pass Access with, and the worker that spends it
	 * keeps its id.
	 */
	async invite(
		access: ServiceToken | null = null,
	): Promise<{ token: string; expiresAt: number }> {
		const token = joinToken(`splj_${secret()}`, access);
		const expiresAt = this.wall.now() + JOIN_WITHIN.ms;
		await this.change((kept) => ({
			...kept,
			joins: [
				...this.unswept(kept),
				{ hash: sha256(token), expiresAt, access: access?.id ?? null },
			],
		}));
		return { token, expiresAt };
	}

	/**
	 * Forgets each join token run out unused, answering the ids of the
	 * service tokens minted for them, to revoke.
	 */
	async sweep(): Promise<string[]> {
		const now = this.wall.now();
		const expired = this.kept.joins.filter((each) => each.expiresAt <= now);
		if (expired.length === 0) {
			return [];
		}
		await this.change((kept) => ({ ...kept, joins: this.live(kept) }));
		return expired.flatMap((each) =>
			each.access === null ? [] : [each.access],
		);
	}

	/**
	 * Spends `token` to let worker `id` join, answering the key it connects
	 * with from now on, or null for a token unknown, spent or run out. A
	 * worker joining again under its id gets a new key, which revokes the
	 * old.
	 */
	async join(token: string, id: string): Promise<string | null> {
		const hash = sha256(token);
		const spent = this.live(this.kept).find((each) => same(each.hash, hash));
		if (spent === undefined) {
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
			updating: false,
			provisioned: was?.provisioned ?? null,
			access: spent.access,
			wake: was?.wake ?? null,
			wokenAt: was?.wokenAt ?? null,
		};
		await this.change((kept) => ({
			...kept,
			workers: [...kept.workers.filter((each) => each.id !== id), record],
			joins: this.unswept(kept).filter((each) => !same(each.hash, hash)),
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
				updating: false,
				provisioned: null,
				access: null,
				wake: null,
				wokenAt: null,
			}),
			...settings,
		};
		await this.change((kept) => ({
			...kept,
			workers: [...kept.workers.filter((each) => each.id !== id), record],
		}));
		return record;
	}

	/** Forgets worker `id`, revoking its key; answers what was kept of it, if anything. */
	async remove(id: string): Promise<WorkerRecord | undefined> {
		const was = this.of(id);
		if (was === undefined) {
			return undefined;
		}
		await this.change((kept) => ({
			...kept,
			workers: kept.workers.filter((each) => each.id !== id),
		}));
		return was;
	}

	/** The joins `sweep` has yet to see: those live, and those run out with a service token to revoke. */
	private unswept(kept: KeptFile): KeptFile["joins"] {
		const now = this.wall.now();
		return kept.joins.filter(
			(each) => each.expiresAt > now || each.access !== null,
		);
	}

	private live(kept: KeptFile): KeptFile["joins"] {
		const now = this.wall.now();
		return kept.joins.filter((each) => each.expiresAt > now);
	}

	private change(next: (kept: KeptFile) => KeptFile): Promise<void> {
		this.kept = next(this.kept);
		const document = this.document;
		if (document === null) {
			return Promise.resolve();
		}
		const kept = this.kept;
		this.writing = this.writing
			.catch(() => {})
			.then(() => document.write(kept));
		return this.writing;
	}
}

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
	/**
	 * Drains to be replaced by one on the coordinator's build, a rollout's
	 * one at a time: its agents move off at their next pause.
	 */
	updating: z.boolean().default(false),
	/** What its provider made it as, for one splates made; null for one that joined by hand. */
	provisioned: z
		.object({
			type: z.string(),
			dollarsPerHour: z.number(),
			/** How its type is billed; by the second for a record from before this was kept. */
			billing: z.enum(["hour", "second"]).default("second"),
			/** When its machine was asked for, epoch milliseconds; null for a record from before this was kept. */
			createdAt: z.number().nullable().default(null),
		})
		.nullable()
		.default(null),
	/** The id of the Cloudflare Access service token it passes Access with; null for none. */
	access: z.string().nullable().default(null),
	/**
	 * What waking it takes, for one that may sleep, as its last hello said,
	 * with the platform and slots it said beside it: kept so that it can be
	 * woken, and the queue known to fit it, while it sleeps through a
	 * restart. Null for one that never sleeps.
	 */
	wake: z
		.object({
			mac: z.string(),
			broadcast: z.string(),
			platform: z.string().nullable(),
			slots: z.number().int().min(1).nullable(),
		})
		.nullable()
		.default(null),
	/** When it last joined after it was woken, epoch milliseconds, so Wake-on-LAN works for it; null before. */
	wokenAt: z.number().nullable().default(null),
});

const Kept = z.object({
	workers: z.array(Record).default([]),
	/**
	 * Join tokens not yet used, by their sha256, with when each runs out and
	 * the service token minted for it, if any.
	 */
	joins: z
		.array(
			z.object({
				hash: z.string(),
				expiresAt: z.number(),
				access: z.string().nullable().default(null),
			}),
		)
		.default([]),
	/** Whether this machine's own worker runs agents; false once it is removed. */
	local: z.boolean().default(true),
});

type KeptFile = z.output<typeof Kept>;

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

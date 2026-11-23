import type { Lock } from "core/system";
import { z } from "zod";
import { SLOT_POOL, type Slot } from "../ports";
import type { Document, Storage } from "../storage";

/** The file's own format. */
const FORMAT = 1;

const Claim = z.object({
	/** Unique rig+tree identity: `<group>/<rig>@<treePath>`. */
	key: z.string(),
	/** Directory of the tree that holds the claim; once gone, the slot is free. */
	tree: z.string(),
});

const File = z.object({
	format: z.number(),
	claims: z.record(z.string(), Claim),
});

/** The rig slot claims file as stored in machine storage. */
export type RigSlotsFile = z.infer<typeof File>;

/** What {@link RigSlots} checks tree existence and serializes claims with. */
export interface RigSlotsDeps {
	/** Whether a tree path still exists on disk. */
	exists: (path: string) => Promise<boolean>;
	/** Held while claiming so concurrent starts never take the same animal. */
	lock: Lock;
	pool?: readonly Slot[];
}

/**
 * Persistent animal-slot claims for tunnel-exposed rigs, kept in machine
 * storage (`rig-slots.json`) so every project sharing `--ports-host` draws
 * from one pool without colliding. A rig+tree keeps its animal across
 * restarts until its tree directory ceases to exist.
 */
export class RigSlots {
	constructor(
		private readonly document: Document<RigSlotsFile>,
		private readonly deps: RigSlotsDeps,
	) {}

	/** The rig slot claims kept in `storage`. */
	static in(storage: Storage, deps: Omit<RigSlotsDeps, "lock">): RigSlots {
		return new RigSlots(storage.document("rig-slots.json"), {
			...deps,
			lock: storage.lock("rig-slots.lock"),
		});
	}

	/** An in-memory slot pool for tests and callers without persistent storage. */
	static memory(
		deps: {
			exists?: (path: string) => Promise<boolean>;
			pool?: readonly Slot[];
		} = {},
	): RigSlots {
		let stored: RigSlotsFile | null = null;
		let tail = Promise.resolve();
		let release: (() => void) | null = null;
		const document: Document<RigSlotsFile> = {
			key: "memory:rig-slots.json",
			read: async () => stored,
			write: async (value) => {
				stored = value;
			},
			update: async (edit) => {
				const next = await edit(stored);
				stored = next;
				return next;
			},
			remove: async () => {
				stored = null;
			},
		};
		const unlock = async () => {
			const done = release;
			release = null;
			done?.();
		};
		const lock: Lock = {
			acquire: async () => {
				const prev = tail;
				let done!: () => void;
				tail = new Promise<void>((resolve) => {
					done = resolve;
				});
				await prev;
				release = done;
			},
			release: unlock,
			releaseIfOurs: unlock,
		};
		return new RigSlots(document, {
			exists: deps.exists ?? (async () => true),
			lock,
			pool: deps.pool,
		});
	}

	/**
	 * The animal slot `key` (on `tree`) holds, claiming the first free one in
	 * pool order when it holds none. Claims whose `tree` no longer exists are
	 * reclaimed automatically. Throws listing holders when every animal is held.
	 */
	async claim(key: string, tree: string): Promise<Slot> {
		const { lock, exists, pool = SLOT_POOL } = this.deps;
		await lock.acquire();
		try {
			const claims = await this.read();
			const owned = pool.find(({ word }) => claims[word]?.key === key);
			if (owned !== undefined) {
				if (claims[owned.word]?.tree !== tree) {
					await this.write({ ...claims, [owned.word]: { key, tree } });
				}
				return owned;
			}
			const next = { ...claims };
			const holders: string[] = [];
			for (const slot of pool) {
				const holder = claims[slot.word];
				if (holder !== undefined && (await exists(holder.tree))) {
					holders.push(`  ${slot.word}: ${holder.key}`);
					continue;
				}
				next[slot.word] = { key, tree };
				await this.write(next);
				return slot;
			}
			throw new Error(
				[
					"every rig slot is held:",
					...holders,
					"remove a worktree to free its slot",
				].join("\n"),
			);
		} finally {
			await lock.release();
		}
	}

	/** Releases any animal slot held by `key`; answers whether one was freed. */
	async release(key: string): Promise<boolean> {
		const { lock } = this.deps;
		await lock.acquire();
		try {
			const claims = await this.read();
			const entry = Object.entries(claims).find(
				([, claim]) => claim.key === key,
			);
			if (entry === undefined) {
				return false;
			}
			const { [entry[0]]: _, ...rest } = claims;
			await this.write(rest);
			return true;
		} finally {
			await lock.release();
		}
	}

	private async read(): Promise<Record<string, z.infer<typeof Claim>>> {
		const unreadable = new Error(
			`${this.document.key} is not rig slots this splates reads: remove it to start over`,
		);
		let stored: unknown;
		try {
			stored = await this.document.read();
		} catch {
			throw unreadable;
		}
		if (stored === null) {
			return {};
		}
		const parsed = File.safeParse(stored);
		if (!parsed.success || parsed.data.format > FORMAT) {
			throw unreadable;
		}
		return parsed.data.claims;
	}

	private async write(
		claims: Record<string, z.infer<typeof Claim>>,
	): Promise<void> {
		await this.document.write({ format: FORMAT, claims });
	}
}

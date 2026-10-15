import type { Fs, Lock, Ps } from "webappwiz/system";
import { z } from "zod";

/** The file in a slot's home that its server writes its pid to. */
export const SERVER_PID = "server.pid";

/** The file's own format. */
const FORMAT = 1;

/**
 * The words `arbor dev --slot` hands out, tried in this order, as
 * sound2score's dev slots are: short animals, spellable into a phone, each
 * with an emoji that is that animal and nothing else.
 * Each one's tunnel is made on its first ever claim and kept, so this is also
 * every host name a slot will ever answer on. When every one is held, add the
 * next: goat 🐐, seal 🦭.
 */
export const SLOT_POOL: readonly { word: string; emoji: string }[] = [
	{ word: "cat", emoji: "😸" },
	{ word: "bee", emoji: "🐝" },
	{ word: "dog", emoji: "🐶" },
	{ word: "fox", emoji: "🦊" },
	{ word: "owl", emoji: "🦉" },
	{ word: "pig", emoji: "🐷" },
	{ word: "lion", emoji: "🦁" },
	{ word: "wolf", emoji: "🐺" },
	{ word: "bear", emoji: "🐻" },
	{ word: "frog", emoji: "🐸" },
	{ word: "duck", emoji: "🦆" },
	{ word: "crab", emoji: "🦀" },
];

/** A word of the pool, which names a slot's tunnel, host and home. */
export interface Slot {
	/** Like "fox". */
	word: string;
	/** Like "🦊": shown beside the project's name while this slot serves it. */
	emoji: string;
}

/** The emoji of `word`, or null for a word not in the pool. */
export function slotOf(word: string): Slot | null {
	return SLOT_POOL.find((each) => each.word === word) ?? null;
}

const Claims = z.object({
	format: z.number(),
	/** Each claimed word, and the tree that holds it. */
	claims: z.record(z.string(), z.string()),
});

/**
 * Which tree holds which slot, kept in `~/.arbor/slots.json` for every
 * checkout on this machine. A tree holds the same word every time, so its host
 * name is worth writing down, until the tree no longer exists and its server
 * has stopped: a worktree gives its slot back by being removed, never by
 * anyone tidying up, but a server left running from a merged worktree still
 * holds its port and its host, so its word goes to no other tree.
 */
export class Slots {
	constructor(
		/** `~/.arbor/slots.json`, or a test's own. */
		readonly path: string,
		private readonly deps: {
			fs: Fs;
			/** Tells whether a slot's last server still runs. */
			ps: Pick<Ps, "pid" | "alive" | "processes">;
			/** Held while claiming, so two trees starting together get a word each. */
			lock: Lock;
			pool?: readonly { word: string; emoji: string }[];
		},
	) {}

	/**
	 * The slot `tree` holds, claimed now when it holds none: the first word no
	 * tree that still exists holds, and no server still runs on. Throws, naming each holder, when every word
	 * is held.
	 */
	async claim(tree: string): Promise<Slot> {
		const { fs, lock, pool = SLOT_POOL } = this.deps;
		await fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")));
		await lock.acquire();
		try {
			const claims = await this.read();
			const held = pool.find(({ word }) => claims[word] === tree);
			if (held !== undefined) {
				return held;
			}
			const holders: string[] = [];
			for (const slot of pool) {
				const holder = claims[slot.word];
				if (holder !== undefined && (await fs.exists(holder))) {
					holders.push(`  ${slot.word}: ${holder}`);
					continue;
				}
				const pid = await this.server(slot);
				if (pid !== null) {
					holders.push(
						`  ${slot.word}: pid ${pid}${holder === undefined ? "" : `, run from ${holder}`}`,
					);
					continue;
				}
				await this.write({ ...claims, [slot.word]: tree });
				return slot;
			}
			throw new Error(
				[
					"every dev slot is held:",
					...holders,
					`remove one of those worktrees, stop one of those servers, or remove a claim in ${this.path}`,
				].join("\n"),
			);
		} finally {
			await lock.release();
		}
	}

	/** The slot's home, its `ARBOR_HOME`: `~/.arbor/slots/<word>`. */
	home(slot: Slot): string {
		return `${this.path.slice(0, this.path.lastIndexOf("/"))}/slots/${slot.word}`;
	}

	/**
	 * The pid of the slot's last server while it still runs, as one does when
	 * its wrapper was killed or its worktree merged; null once it has stopped,
	 * or for this process itself.
	 */
	async server(slot: Slot): Promise<number | null> {
		const { fs, ps } = this.deps;
		const file = `${this.home(slot)}/${SERVER_PID}`;
		if (!(await fs.exists(file))) {
			return null;
		}
		const pid = Number.parseInt((await fs.read(file)).trim(), 10);
		if (!Number.isInteger(pid) || pid === ps.pid || !ps.alive(pid)) {
			return null;
		}
		// A pid the kernel has since handed to another program is no server.
		const running = (await ps.processes()).find((each) => each.pid === pid);
		if (running !== undefined && !/\bdev\b/.test(running.command)) {
			return null;
		}
		return pid;
	}

	/** Each slot a tree that still exists holds, in the pool's order. */
	async list(): Promise<{ slot: Slot; tree: string }[]> {
		const { fs, pool = SLOT_POOL } = this.deps;
		const claims = await this.read();
		const held: { slot: Slot; tree: string }[] = [];
		for (const slot of pool) {
			const tree = claims[slot.word];
			if (tree !== undefined && (await fs.exists(tree))) {
				held.push({ slot, tree });
			}
		}
		return held;
	}

	private async read(): Promise<Record<string, string>> {
		const raw = await this.deps.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return {};
		}
		const parsed = Claims.safeParse(JSON.parse(raw));
		if (!parsed.success || parsed.data.format > FORMAT) {
			throw new Error(
				`${this.path} is not slots this arbor reads: remove it to start over`,
			);
		}
		return parsed.data.claims;
	}

	private async write(claims: Record<string, string>): Promise<void> {
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.deps.fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, claims }, null, "\t")}\n`,
		);
		await this.deps.fs.rename(tmp, this.path);
	}
}

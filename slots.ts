import type { Fs, Lock } from "webappwiz/system";
import { z } from "zod";

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
 * name is worth writing down, until the tree no longer exists: a worktree
 * gives its slot back by being removed, never by anyone tidying up.
 */
export class Slots {
	constructor(
		/** `~/.arbor/slots.json`, or a test's own. */
		readonly path: string,
		private readonly deps: {
			fs: Fs;
			/** Held while claiming, so two trees starting together get a word each. */
			lock: Lock;
			pool?: readonly { word: string; emoji: string }[];
		},
	) {}

	/**
	 * The slot `tree` holds, claimed now when it holds none: the first word no
	 * tree that still exists holds. Throws, naming each holder, when every word
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
				await this.write({ ...claims, [slot.word]: tree });
				return slot;
			}
			throw new Error(
				[
					"every dev slot is held:",
					...holders,
					`remove one of those worktrees, or its claim in ${this.path}`,
				].join("\n"),
			);
		} finally {
			await lock.release();
		}
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

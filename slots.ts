import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Lock, type Ps } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { z } from "zod";
import { arborHome } from "./roster";

/** The file in a slot's home that its server writes its pid to. */
export const SERVER_PID = "server.pid";

/** Set in a slot's server's environment to the word it serves under. */
export const SLOT = "ARBOR_SLOT";

/**
 * Set in a slot's server's environment to the machine's `ARBOR_HOME`, whose
 * tunnel and slots the page lists to switch between.
 */
export const MACHINE_HOME = "ARBOR_MACHINE_HOME";

/** How long `stop` gives a server to end on a SIGTERM before a SIGKILL. */
const STOP_WAIT = Duration.secs(5);

/** The file's own format. */
const FORMAT = 1;

/**
 * Which tree holds which slot, kept in `~/.arbor/slots.json` for every
 * checkout on this machine. A tree holds the same word every time, so its host
 * name is worth writing down, for as long as it owns it: a task's worktree
 * owns its word until the task merges or is removed, which stops its server
 * and gives the word back. The main tree of an arbor repository owns none,
 * since every agent of it stands there, so one agent's slot would be every
 * other's to stop. A server left running from a tree that owns its word no
 * more still holds its port and its host, so its word goes to no other tree
 * until `prune` stops it.
 */
export class Slots {
	constructor(
		/** `~/.arbor/slots.json`, or a test's own. */
		readonly path: string,
		private readonly deps: {
			fs: Fs;
			/** Tells whether a slot's last server still runs. */
			ps: Pick<Ps, "pid" | "alive" | "processes" | "spawnCapture">;
			/** Held while claiming, so two trees starting together get a word each. */
			lock: Lock;
			pool?: readonly { word: string; emoji: string }[];
		},
	) {}

	/** The machine's slots, read from inside a slot's server too. */
	static ofMachine({ fs, ps, log }: { fs: Fs; ps: Ps; log: Logger }): Slots {
		const home = ps.env(MACHINE_HOME) ?? arborHome(ps);
		return new Slots(`${home}/slots.json`, {
			fs,
			ps,
			lock: new FileLock(`${home}/slots.lock`, { fs, ps, log }),
		});
	}

	/**
	 * Whether `tree` can own a word: it exists, and is no arbor repository's
	 * main tree, whose `.git` is a directory holding arbor's records rather
	 * than a linked worktree's file.
	 */
	async owns(tree: string): Promise<boolean> {
		const { fs } = this.deps;
		return (await fs.exists(tree)) && !(await fs.exists(`${tree}/.git/arbor`));
	}

	/**
	 * The slot `tree` holds, claimed now when it holds none: the first word no
	 * tree that owns it holds, and no server still runs on. Throws, naming each
	 * holder, when every word is held.
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
				if (holder !== undefined && (await this.owns(holder))) {
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
					"each is another task's: `arbor slots prune` frees those no task owns any more, and stops their servers; never stop another task's server or edit its claim",
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

	/** Each slot a tree that owns it holds, in the pool's order. */
	async list(): Promise<{ slot: Slot; tree: string }[]> {
		const { pool = SLOT_POOL } = this.deps;
		const claims = await this.read();
		const held: { slot: Slot; tree: string }[] = [];
		for (const slot of pool) {
			const tree = claims[slot.word];
			if (tree !== undefined && (await this.owns(tree))) {
				held.push({ slot, tree });
			}
		}
		return held;
	}

	/** Every claimed word, owned or orphaned, with its server, in the pool's order. */
	async status(): Promise<Held[]> {
		const { pool = SLOT_POOL } = this.deps;
		const claims = await this.read();
		const held: Held[] = [];
		for (const slot of pool) {
			const tree = claims[slot.word];
			if (tree !== undefined) {
				held.push({
					slot,
					tree,
					pid: await this.server(slot),
					orphaned: !(await this.owns(tree)),
				});
			}
		}
		return held;
	}

	/**
	 * Stops the slot's server, if one runs, which ends its cloudflared too:
	 * a SIGTERM, then a SIGKILL if it outlives `STOP_WAIT`. Answers with the
	 * pid it stopped, or null when none ran.
	 */
	async stop(slot: Slot): Promise<number | null> {
		const { ps } = this.deps;
		const pid = await this.server(slot);
		if (pid === null) {
			return null;
		}
		await ps.spawnCapture(["kill", String(pid)]);
		const deadline = Date.now() + STOP_WAIT.ms;
		while (ps.alive(pid)) {
			if (Date.now() >= deadline) {
				await ps.spawnCapture(["kill", "-KILL", String(pid)]);
				break;
			}
			await sleep(Duration.ms(100));
		}
		return pid;
	}

	/**
	 * Gives back the word `tree` holds, stopping its server, as a task's
	 * worktree does when it merges or is removed. Answers with what it gave
	 * back, or null when the tree held none.
	 */
	async release(
		tree: string,
	): Promise<{ slot: Slot; stopped: number | null } | null> {
		const { lock, pool = SLOT_POOL } = this.deps;
		// Most trees never held one: no lock to take for them, in a home that
		// may not exist yet.
		if (!Object.values(await this.read()).includes(tree)) {
			return null;
		}
		await lock.acquire();
		try {
			const claims = await this.read();
			const slot = pool.find(({ word }) => claims[word] === tree);
			if (slot === undefined) {
				return null;
			}
			const stopped = await this.stop(slot);
			const { [slot.word]: _, ...rest } = claims;
			await this.write(rest);
			return { slot, stopped };
		} finally {
			await lock.release();
		}
	}

	/**
	 * Frees every orphaned word, as `status` tells them, stopping its server:
	 * the only slots any agent may stop, since each of the rest is a task's.
	 * Answers with what it freed.
	 */
	async prune(): Promise<Held[]> {
		const { lock } = this.deps;
		if (!(await this.deps.fs.exists(this.path))) {
			return [];
		}
		await lock.acquire();
		try {
			const orphans = (await this.status()).filter(({ orphaned }) => orphaned);
			const claims = await this.read();
			for (const orphan of orphans) {
				await this.stop(orphan.slot);
				delete claims[orphan.slot.word];
			}
			if (orphans.length > 0) {
				await this.write(claims);
			}
			return orphans;
		} finally {
			await lock.release();
		}
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

/** What `release` gave back, as `merge` and `remove` report it. */
export function freedLine({
	slot,
	stopped,
}: {
	slot: Slot;
	stopped: number | null;
}): string {
	return `${slot.word} ${slot.emoji} given back${stopped === null ? "" : `, its server (pid ${stopped}) stopped`}`;
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

/** A claimed word, the tree that holds it, and its server while one runs. */
export interface Held {
	slot: Slot;
	tree: string;
	/** The pid of its server while one runs, as `server` tells. */
	pid: number | null;
	/**
	 * Whether no tree can be said to own it any more: its tree is gone, or is
	 * the main tree of an arbor repository, which every agent of it shares.
	 * Only an orphan's server is any agent's to stop, by `prune`.
	 */
	orphaned: boolean;
}

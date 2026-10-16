import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Lock, type Ps } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { z } from "zod";
import { arborHome } from "./roster";
import { MACHINE_HOME } from "./slots";

/**
 * How many heavy jobs run at once on a machine when `ARBOR_HEAVY_JOBS` says
 * nothing. One `bin/wiz dev test` takes about 7 cores and 7.3 GB, so two
 * bound the spike near 15 GB on a 64 GB Mac running two dozen sessions.
 */
export const HEAVY_JOBS_DEFAULT = 2;

/** Sets the cap for the machine, read by every arbor that takes a slot. */
export const HEAVY_JOBS = "ARBOR_HEAVY_JOBS";

/**
 * The machine's heavy-job slots: `take` one before a test run or an install,
 * and dispose of it after; `read` says who holds them and who waits. A holder
 * that dies gives its slot back by dying.
 */
export class HeavyJobs implements HeavyCap {
	// A counting semaphore kept in one file under the machine's arbor home,
	// each entry by pid: every look drops those of processes no longer alive.
	readonly #path: string;
	readonly #opts: HeavyJobsOptions;
	#ids = 0;

	/**
	 * This machine's, under the home `arbor dev --slot` names its servers'
	 * machine by, else `ARBOR_HOME`, so every server on one machine shares one
	 * cap; capped by `ARBOR_HEAVY_JOBS`.
	 */
	static ofMachine({
		fs,
		ps,
		log,
	}: {
		fs: Fs;
		ps: Ps;
		log: Logger;
	}): HeavyJobs {
		const home = ps.env(MACHINE_HOME) ?? arborHome(ps);
		return new HeavyJobs(`${home}/heavy.json`, {
			fs,
			ps,
			log,
			lock: new FileLock(`${home}/heavy.lock`, { fs, ps, log }),
			cap: capOf(ps.env(HEAVY_JOBS)),
		});
	}

	constructor(
		/** `~/.arbor/heavy.json`, or a test's own. */
		path: string,
		opts: HeavyJobsOptions,
	) {
		this.#path = path;
		this.#opts = opts;
	}

	async take({
		what,
		task = null,
	}: {
		what: string;
		task?: string | null;
	}): Promise<HeavySlot> {
		const { ps, log, now = () => new Date() } = this.#opts;
		if (ps.env(HEAVY_HELD) !== undefined) {
			return { env: {}, [Symbol.asyncDispose]: async () => {} };
		}
		const entry: Entry = {
			id: `${ps.pid}-${this.#ids++}`,
			what,
			task,
			pid: ps.pid,
			since: now().toISOString(),
		};
		let told = false;
		// Short first waits, so a slot freed quickly is taken quickly.
		let wait = Duration.ms(50);
		for (;;) {
			const holders = await this.#change((file) => {
				const waiting = file.waiting.some((each) => each.id === entry.id)
					? file.waiting
					: [...file.waiting, entry];
				const ahead = waiting.findIndex((each) => each.id === entry.id);
				if (file.running.length + ahead < this.#opts.cap) {
					return {
						file: {
							running: [
								...file.running,
								{ ...entry, since: now().toISOString() },
							],
							waiting: waiting.filter((each) => each.id !== entry.id),
						},
						holders: null,
					};
				}
				return { file: { ...file, waiting }, holders: file.running };
			});
			if (holders === null) {
				break;
			}
			if (!told) {
				told = true;
				log.info(
					[
						`waiting for ${this.#opts.cap === 1 ? "the heavy-job slot" : `one of ${this.#opts.cap} heavy-job slots`} for ${what}, held by:`,
						...holders.map((each) => `  ${describe(each)}`),
					].join("\n"),
				);
			}
			await sleep(wait);
			wait = Duration.ms(Math.min(wait.ms * 2, POLL.ms));
		}
		if (told) {
			log.info(`took a heavy-job slot for ${what}`);
		}
		return {
			env: { [HEAVY_HELD]: entry.id },
			[Symbol.asyncDispose]: () => this.#give(entry.id),
		};
	}

	async read(): Promise<HeavyJobsReading> {
		const file = this.#living(await this.#read());
		return { cap: this.#opts.cap, ...file };
	}

	async #give(id: string): Promise<void> {
		await this.#change((file) => ({
			file: {
				running: file.running.filter((each) => each.id !== id),
				waiting: file.waiting.filter((each) => each.id !== id),
			},
			holders: null,
		}));
	}

	async #change<T>(
		change: (file: File) => { file: File; holders: T },
	): Promise<T> {
		const { fs, lock } = this.#opts;
		await fs.mkdir(this.#path.slice(0, this.#path.lastIndexOf("/")));
		await lock.acquire();
		try {
			const { file, holders } = change(this.#living(await this.#read()));
			await fs.write(this.#path, JSON.stringify(file));
			return holders;
		} finally {
			await lock.release();
		}
	}

	#living(file: File): File {
		const alive = (each: Entry) => this.#opts.ps.alive(each.pid);
		return {
			running: file.running.filter(alive),
			waiting: file.waiting.filter(alive),
		};
	}

	async #read(): Promise<File> {
		const raw = await this.#opts.fs.read(this.#path).catch(() => null);
		try {
			return raw === null
				? { running: [], waiting: [] }
				: File.parse(JSON.parse(raw));
		} catch {
			// A file no reader can take holds no one who could still give back.
			return { running: [], waiting: [] };
		}
	}
}

/**
 * What runs in a slot finds this in its environment: a heavy job it starts,
 * such as the test run of a `preMerge` hook, runs in that slot too.
 */
export const HEAVY_HELD = "ARBOR_HEAVY";

/** A job that holds, or waits for, one of the machine's slots. */
export interface HeavyJob {
	/** What it runs, as the page and a waiter name it: "preMerge", "bun test". */
	what: string;
	/** The task it runs for, or null outside one. */
	task: string | null;
	/** The process that holds the slot, which frees it by exiting. */
	pid: number;
	/** When it started holding, or waiting. */
	since: string;
}

/** Who holds the machine's slots, and who waits for one, first come first. */
export interface HeavyJobsReading {
	cap: number;
	running: HeavyJob[];
	waiting: HeavyJob[];
}

/** A slot taken, which its holder gives back when the job is done. */
export interface HeavySlot extends AsyncDisposable {
	/** What to add to the environment of what runs in it: see `HEAVY_HELD`. */
	readonly env: Record<string, string>;
}

/**
 * Caps the heavy jobs (test runs, installs, browser launches) running at
 * once, so several agents testing together queue rather than pinning the CPU
 * and running out of memory. A worker of a pool holds a cap of its own.
 */
export interface HeavyCap {
	/** Waits for a free slot, saying what holds them all while it waits. */
	take(job: { what: string; task?: string | null }): Promise<HeavySlot>;
	read(): Promise<HeavyJobsReading>;
}

const Entry = z.object({
	id: z.string(),
	what: z.string(),
	task: z.string().nullable(),
	pid: z.number(),
	since: z.string(),
});
type Entry = z.infer<typeof Entry>;

const File = z.object({ running: z.array(Entry), waiting: z.array(Entry) });
type File = z.infer<typeof File>;

/** How long a waiter sleeps between looks, at most. */
const POLL = Duration.secs(1);

export interface HeavyJobsOptions {
	fs: Fs;
	/** Tells a holder that died from one still running, and whose job this is. */
	ps: Pick<Ps, "pid" | "alive" | "env">;
	/** Held while the file is read and rewritten, never while a job runs. */
	lock: Lock;
	log: Logger;
	cap: number;
	/** The current time; a test passes its own. */
	now?: () => Date;
}

/** The cap `ARBOR_HEAVY_JOBS` names, or the default for none or nonsense. */
export function capOf(value: string | undefined): number {
	const cap = Number(value);
	return Number.isInteger(cap) && cap > 0 ? cap : HEAVY_JOBS_DEFAULT;
}

function describe(job: HeavyJob): string {
	return `${job.what}${job.task === null ? "" : ` in ${job.task}`} (pid ${job.pid}, since ${job.since})`;
}

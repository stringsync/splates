import { availableParallelism } from "node:os";
import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Lock, type Ps } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { splatesHome } from "../models";
import { MACHINE_HOME } from "../ports";

/** Sets how many cores heavy jobs may claim between them on this machine. */
export const HEAVY_CORES = "SPLATES_HEAVY_CORES";

/** Cores left to the server, the agents and git when the budget is not set. */
export const CORES_RESERVED = 2;

/** How long a claim waits for its cores before it gives up. */
export const CORES_TIMEOUT = Duration.mins(5);

/**
 * What runs inside a claim finds its cores in this variable: a claim it makes
 * takes those, as `splates dev test` does in a merge's gate, and claims none.
 */
export const CORES_HELD = "SPLATES_CORES";

/**
 * A claim that goes `first` (a merge's gate, which others wait on) joins the
 * line ahead of ordinary waiters that have waited less than this, so one that
 * has waited longer keeps the rest of its timeout to get its cores.
 */
export const FIRST_PASSES_UNDER = Duration.mins(2);

const POLL = Duration.secs(1);

/** The cores heavy jobs may claim: `SPLATES_HEAVY_CORES`, else all but two. */
export function coreBudgetOf(
	value: string | undefined,
	cores: number = availableParallelism(),
): number {
	const budget = Number(value);
	return Number.isInteger(budget) && budget > 0
		? budget
		: Math.max(1, cores - CORES_RESERVED);
}

/** A job that holds, or waits for, cores. */
export interface CoreJob {
	id: string;
	what: string;
	pid: number;
	/** The cores it holds, or the fewest it would take while it waits. */
	cores: number;
	since: string;
	/** Whether it went ahead of ordinary waiters, as a merge's gate does. */
	first?: boolean;
}

interface CoresFile {
	running: CoreJob[];
	waiting: CoreJob[];
}

/** Cores claimed, which the holder gives back when the job is done. */
export interface CoreClaim extends AsyncDisposable {
	readonly cores: number;
	/** What to add to the environment of what runs in it, to run on these cores. */
	readonly env: Record<string, string>;
}

export interface CoreClaimsOptions {
	fs: Fs;
	ps: Pick<Ps, "pid" | "alive" | "env">;
	lock: Lock;
	log: Logger;
	/** How many cores the claims share. */
	budget: number;
	/** How long a claim waits; a test passes its own. */
	timeout?: Duration;
	poll?: Duration;
}

/**
 * The machine's cores heavy jobs share, so one test run cannot take them all.
 * `claim` waits first come first served until `min` cores are free, then takes
 * up to `want` of them; a `first` claim waits ahead of ordinary ones. A holder
 * that dies gives its cores back by dying.
 */
export class CoreClaims {
	readonly #path: string;
	readonly #opts: CoreClaimsOptions;
	#ids = 0;

	static under(
		dir: string,
		opts: Omit<CoreClaimsOptions, "lock"> & { lock?: Lock },
	): CoreClaims {
		return new CoreClaims(`${dir}/cores.json`, {
			...opts,
			lock:
				opts.lock ??
				new FileLock(`${dir}/cores.lock`, {
					fs: opts.fs,
					ps: opts.ps as Ps,
					log: opts.log,
				}),
		});
	}

	constructor(path: string, opts: CoreClaimsOptions) {
		this.#path = path;
		this.#opts = opts;
	}

	/** How many cores the claims share. */
	get budget(): number {
		return this.#opts.budget;
	}

	async claim({
		what,
		want,
		min = want,
		first = false,
	}: {
		what: string;
		want: number;
		min?: number;
		first?: boolean;
	}): Promise<CoreClaim> {
		const { ps, log, budget } = this.#opts;
		const inherited = Number(ps.env(CORES_HELD));
		if (Number.isInteger(inherited) && inherited > 0) {
			return {
				cores: inherited,
				env: {},
				[Symbol.asyncDispose]: async () => {},
			};
		}
		const timeout = this.#opts.timeout ?? CORES_TIMEOUT;
		const poll = this.#opts.poll ?? POLL;
		const most = Math.min(want, budget);
		const least = Math.min(min, most);
		const entry: CoreJob = {
			id: `${ps.pid}-${this.#ids++}`,
			what,
			pid: ps.pid,
			cores: least,
			since: new Date().toISOString(),
			...(first ? { first } : {}),
		};
		const deadline = Date.now() + timeout.ms;
		let told = false;
		let granted = 0;
		while (granted === 0) {
			const held = await this.#change((file) => {
				const waiting = file.waiting.some((each) => each.id === entry.id)
					? file.waiting
					: joined(file.waiting, entry);
				const free = budget - sum(file.running);
				if (waiting[0]?.id === entry.id && free >= least) {
					const cores = Math.min(most, free);
					return {
						file: {
							running: [...file.running, { ...entry, cores }],
							waiting: waiting.slice(1),
						},
						cores,
						holders: file.running,
					};
				}
				return {
					file: { ...file, waiting },
					cores: 0,
					holders: file.running,
				};
			});
			granted = held.cores;
			if (granted > 0) {
				break;
			}
			if (Date.now() >= deadline) {
				await this.#give(entry.id);
				throw new Error(
					`Waited ${timeout.mins} minutes for ${least} of the machine's ${budget} cores for ${what} and got none, held by: ${describeAll(held.holders)}`,
				);
			}
			if (!told) {
				told = true;
				log.info(
					[
						`waiting to claim ${least} of the machine's ${budget} cores for ${what}, up to ${timeout.mins} minutes; held by:`,
						...held.holders.map((each) => `  ${describe(each)}`),
					].join("\n"),
				);
			}
			await sleep(poll);
		}
		if (told) {
			log.info(`claimed ${granted} cores for ${what}`);
		}
		return {
			cores: granted,
			env: { [CORES_HELD]: String(granted) },
			[Symbol.asyncDispose]: () => this.#give(entry.id),
		};
	}

	async read(): Promise<CoresFile & { budget: number }> {
		return { budget: this.#opts.budget, ...this.#living(await this.#read()) };
	}

	async #give(id: string): Promise<void> {
		await this.#change((file) => ({
			file: {
				running: file.running.filter((each) => each.id !== id),
				waiting: file.waiting.filter((each) => each.id !== id),
			},
			cores: 0,
			holders: file.running,
		}));
	}

	async #change(
		change: (file: CoresFile) => {
			file: CoresFile;
			cores: number;
			holders: CoreJob[];
		},
	): Promise<{ cores: number; holders: CoreJob[] }> {
		const { fs, lock } = this.#opts;
		await fs.mkdir(this.#path.slice(0, this.#path.lastIndexOf("/")));
		await lock.acquire();
		try {
			const { file, cores, holders } = change(this.#living(await this.#read()));
			await fs.write(this.#path, JSON.stringify(file));
			return { cores, holders };
		} finally {
			await lock.release();
		}
	}

	#living(file: CoresFile): CoresFile {
		const alive = (each: CoreJob) => this.#opts.ps.alive(each.pid);
		return {
			running: file.running.filter(alive),
			waiting: file.waiting.filter(alive),
		};
	}

	async #read(): Promise<CoresFile> {
		const raw = await this.#opts.fs.read(this.#path).catch(() => null);
		try {
			const parsed = raw === null ? null : JSON.parse(raw);
			return {
				running: Array.isArray(parsed?.running) ? parsed.running : [],
				waiting: Array.isArray(parsed?.waiting) ? parsed.waiting : [],
			};
		} catch {
			return { running: [], waiting: [] };
		}
	}
}

/** The machine's core claims, under the home its heavy-job slots are in. */
export function coreClaimsOfMachine({
	fs,
	ps,
	log,
}: {
	fs: Fs;
	ps: Ps;
	log: Logger;
}): CoreClaims {
	return CoreClaims.under(ps.env(MACHINE_HOME) ?? splatesHome(ps), {
		fs,
		ps,
		log,
		budget: coreBudgetOf(ps.env(HEAVY_CORES)),
	});
}

/** The line with `entry` joined: at its end, or a `first` one ahead of young ordinary waiters. */
function joined(waiting: CoreJob[], entry: CoreJob): CoreJob[] {
	const at = entry.first
		? waiting.findIndex(
				(each) =>
					!each.first &&
					Date.now() - Date.parse(each.since) < FIRST_PASSES_UNDER.ms,
			)
		: -1;
	return at === -1
		? [...waiting, entry]
		: [...waiting.slice(0, at), entry, ...waiting.slice(at)];
}

const sum = (jobs: CoreJob[]) =>
	jobs.reduce((total, each) => total + each.cores, 0);

const describe = (job: CoreJob) =>
	`${job.what}${job.first ? " (first)" : ""}: ${job.cores} cores (pid ${job.pid}, since ${job.since})`;

const describeAll = (jobs: CoreJob[]) =>
	jobs.length === 0 ? "nobody" : jobs.map(describe).join("; ");

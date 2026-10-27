import { availableParallelism, loadavg } from "node:os";
import type { Fs, Ps } from "webappwiz/system";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { splatesHome } from "../models";
import { MACHINE_HOME } from "../ports";

/** How long a load that has ended goes on showing in the one-minute load average, at 1/e of its height after this. */
export const LOAD_LAG = Duration.mins(1);

/**
 * The test workers to give a merge's gate on a machine of `cores` with
 * `load` the person's: the cores it leaves idle, at most all but two and at
 * least half.
 */
export function gateCores(cores: number, load: number): number {
	// The gate runs alone of the premerges, but beside every agent: on 16
	// cores the suite took 58.8s at 8 workers, 50.6s at 11 and 48.5s at 14 on
	// a quiet machine, while 14 at load 32 timed out and 8 did not (2026-10-23).
	const half = Math.max(1, Math.floor(cores / 2));
	return Math.min(
		Math.max(half, cores - 2),
		Math.max(half, Math.floor(cores - load)),
	);
}

/** The most a gate's deadline may stretch to under load, as a multiple of its base. */
// Twice `PREMERGE_TIMEOUT_MS` is `TEST_DEADLINE`, the cap `dev test` gives itself.
export const DEADLINE_STRETCH = 2;

/**
 * How long a gate of `workers` may run on `cores` with `load` the person's:
 * `baseMs` when they all fit the cores, and longer by the share they
 * oversubscribe them, up to `DEADLINE_STRETCH` times.
 */
export function gateDeadline(
	baseMs: number,
	{ cores, load, workers }: GateSizing,
): number {
	// Each worker gets about cores / (load + workers) of a core once the
	// cores are oversubscribed, so the suite takes that much longer: on
	// 2026-10-26, 8 workers at load 13 to 35 on 16 cores were killed at 3
	// minutes eight times in a row, each most of the way through, where 60
	// to 68s is usual at load 12 to 25 and 40s on a quiet machine.
	const stretch = Math.min(
		DEADLINE_STRETCH,
		Math.max(1, (load + workers) / Math.max(1, cores)),
	);
	return Math.round(baseMs * stretch);
}

/** What a gate starting now is sized by. */
export interface GateSizing {
	/** The test workers it may run. */
	workers: number;
	cores: number;
	/** The one-minute load average less what the gate before still adds to it. */
	load: number;
}

/**
 * What a run of `workers` that took `ran`, and ended `since` ago, still adds
 * to the one-minute load average: the share it had built up by its end,
 * decayed since.
 */
export function lingering({
	workers,
	ran,
	since,
}: {
	workers: number;
	ran: Duration;
	since: Duration;
}): number {
	// A run that kept fewer cores busy than it had workers is counted at its
	// workers, so for a minute after it the person's load may count short.
	const built = 1 - Math.exp(-Math.max(0, ran.ms) / LOAD_LAG.ms);
	return workers * built * Math.exp(-Math.max(0, since.ms) / LOAD_LAG.ms);
}

/** The last gate run on this machine, as its file keeps it. */
interface LastGate {
	workers: number;
	ranMs: number;
	endedAt: number;
}

/**
 * Sizes each merge gate by the person's load on the machine, leaving out
 * what the gate before it still adds to the one-minute average. Make one
 * with `ofMachine`, ask `sizing` for a gate about to run and tell `ran`
 * once it has.
 */
// Gates take turns on the premerge lock back to back, and the average keeps
// a gate's workers for about a minute after it ends, which counted as the
// person's would hold the next gate to half the cores. The gate before ran
// in another process, so it is kept in `path`, the machine's as the lock is.
export class GateTrail {
	constructor(
		private readonly fs: Fs,
		private readonly path: string,
		private readonly sensors: {
			cores(): number;
			loadavg(): number[];
		},
		private readonly wall: WallClock = new SystemWallClock(),
	) {}

	static ofMachine(fs: Fs, ps: Ps): GateTrail {
		return new GateTrail(
			fs,
			`${ps.env(MACHINE_HOME) ?? splatesHome(ps)}/gate.last`,
			{
				cores: () => availableParallelism(),
				loadavg: () => loadavg(),
			},
		);
	}

	/** The workers a gate starting now may run. */
	async size(): Promise<number> {
		return (await this.sizing()).workers;
	}

	/** The workers a gate starting now may run, with the cores and load they were sized by. */
	async sizing(): Promise<GateSizing> {
		const last = await this.#last();
		const gone =
			last === null
				? 0
				: lingering({
						workers: last.workers,
						ran: Duration.ms(last.ranMs),
						since: Duration.ms(this.wall.now() - last.endedAt),
					});
		const load = Math.max(0, (this.sensors.loadavg()[0] ?? 0) - gone);
		const cores = this.sensors.cores();
		return { workers: gateCores(cores, load), cores, load };
	}

	/** Keeps a run of `workers` that took `ran` and has just ended, for the next gate to size by. */
	async ran(workers: number, ran: Duration): Promise<void> {
		const last: LastGate = {
			workers,
			ranMs: ran.ms,
			endedAt: this.wall.now(),
		};
		await this.fs.write(this.path, JSON.stringify(last));
	}

	async #last(): Promise<LastGate | null> {
		try {
			const last = JSON.parse(await this.fs.read(this.path)) as LastGate;
			return typeof last.workers === "number" &&
				typeof last.ranMs === "number" &&
				typeof last.endedAt === "number"
				? last
				: null;
		} catch {
			return null;
		}
	}
}

import { availableParallelism, loadavg } from "node:os";
import type { Fs, Ps } from "webappwiz/system";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { splatesHome } from "../models";
import { MACHINE_HOME } from "../ports";

/**
 * The one-minute load average's time constant: a load gone this long ago
 * still shows at 1/e of its height, as the average decays by e^(-t/60s).
 */
export const LOAD_LAG = Duration.mins(1);

/**
 * The test workers a merge's gate may run, on `cores` with `load` the
 * person's: the cores it leaves idle, up to all but two, and never fewer
 * than half.
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
 * Sizes each gate by the load less what the gate before it still adds to
 * it: gates take turns on the premerge lock back to back, and the one-minute
 * average keeps a gate's workers for about a minute after it ends, which
 * counted as the person's would hold the next gate to half the cores. The
 * gate before ran in another process, so it is kept in `path`, the machine's
 * as the lock is (`ofMachine`).
 */
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
		return gateCores(this.sensors.cores(), load);
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

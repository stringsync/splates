import { GATE_PHASES } from "@stringsync/splates-server/server";
import { type Fs, NodeFs, type Ps } from "webappwiz/system";

/**
 * Times the phases of a merge's gate for its log entry, appending each to the
 * file the gate names in `SPLATES_GATE_PHASES`; outside a gate it only runs them.
 */
export class PhaseTimer {
	constructor(
		private readonly ps: Ps,
		private readonly fs: Fs = new NodeFs(),
	) {}

	/**
	 * Runs `phase`, timing it whether it passes or throws. A phase `within`
	 * another runs beside its siblings inside it, so the gate leaves it out
	 * when it works out what time the phases left.
	 */
	async time<T>(
		phase: string,
		run: () => Promise<T>,
		{ within }: { within?: string } = {},
	): Promise<T> {
		const path = this.ps.env(GATE_PHASES);
		const started = performance.now();
		try {
			return await run();
		} finally {
			if (path) {
				const ms = Math.round(performance.now() - started);
				await this.fs.append(
					path,
					`${JSON.stringify({ phase, ms, ...(within ? { within } : {}) })}\n`,
				);
			}
		}
	}

	/** Records the peak memory `phase`'s process tree reached, in megabytes. */
	async peak(phase: string, peakMb: number): Promise<void> {
		const path = this.ps.env(GATE_PHASES);
		if (path) {
			await this.fs.append(path, `${JSON.stringify({ phase, peakMb })}\n`);
		}
	}
}

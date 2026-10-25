import type { GatePhases } from "../records";

/** The phases a gate's command timed, from the lines it appended to `SPLATES_GATE_PHASES`. */
export class TimedPhases {
	constructor(private readonly lines: string) {}

	/**
	 * Sums each phase by name, then adds `setup`, what of the `ranMs` run
	 * they leave. A line that is not a phase is passed over, as a command
	 * cut short may leave half of one.
	 */
	of(ranMs: number): GatePhases["ms"] {
		const ms: GatePhases["ms"] = {};
		for (const line of this.lines.split("\n")) {
			const timed = this.parsed(line);
			if (timed) {
				ms[timed.phase] = (ms[timed.phase] ?? 0) + timed.ms;
			}
		}
		const timed = Object.values(ms).reduce((sum, each) => sum + each, 0);
		ms.setup = Math.max(0, Math.round(ranMs - timed));
		return ms;
	}

	private parsed(line: string): { phase: string; ms: number } | null {
		try {
			const value: unknown = JSON.parse(line);
			return typeof value === "object" &&
				value !== null &&
				"phase" in value &&
				typeof value.phase === "string" &&
				"ms" in value &&
				typeof value.ms === "number"
				? { phase: value.phase, ms: value.ms }
				: null;
		} catch {
			return null;
		}
	}
}

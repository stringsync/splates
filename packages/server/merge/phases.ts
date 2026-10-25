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
		for (const timed of this.parsed("ms")) {
			ms[timed.phase] = (ms[timed.phase] ?? 0) + timed.value;
		}
		const timed = Object.values(ms).reduce((sum, each) => sum + each, 0);
		ms.setup = Math.max(0, Math.round(ranMs - timed));
		return ms;
	}

	/** The highest peak memory each phase's tests reported, in megabytes. */
	peaks(): NonNullable<GatePhases["peakMb"]> {
		const peaks: NonNullable<GatePhases["peakMb"]> = {};
		for (const peaked of this.parsed("peakMb")) {
			peaks[peaked.phase] = Math.max(peaks[peaked.phase] ?? 0, peaked.value);
		}
		return peaks;
	}

	/** The lines that name a phase and give `field` as a number. */
	private parsed(field: "ms" | "peakMb"): { phase: string; value: number }[] {
		return this.lines.split("\n").flatMap((line) => {
			try {
				const value: unknown = JSON.parse(line);
				if (
					typeof value === "object" &&
					value !== null &&
					"phase" in value &&
					typeof value.phase === "string" &&
					field in value
				) {
					const number: unknown = Reflect.get(value, field);
					return typeof number === "number"
						? [{ phase: value.phase, value: number }]
						: [];
				}
				return [];
			} catch {
				return [];
			}
		});
	}
}

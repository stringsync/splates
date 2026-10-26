import type { GatePhases } from "../records";

/** The phases a gate's command timed, from the lines it appended to `SPLATES_GATE_PHASES`. */
export class TimedPhases {
	constructor(private readonly lines: string) {}

	/**
	 * Sums each phase by name, then adds `setup`, what of the `ranMs` run
	 * they leave. A phase `within` another, which ran beside its siblings
	 * there, is kept but leaves the time to its parent. A line that is not a
	 * phase is passed over, as a command cut short may leave half of one.
	 */
	of(ranMs: number): GatePhases["ms"] {
		const ms: GatePhases["ms"] = {};
		let timed = 0;
		for (const phase of this.parsed("ms")) {
			ms[phase.phase] = (ms[phase.phase] ?? 0) + phase.value;
			if (!phase.within) {
				timed += phase.value;
			}
		}
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
	private parsed(
		field: "ms" | "peakMb",
	): { phase: string; value: number; within?: string }[] {
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
					const within: unknown = Reflect.get(value, "within");
					return typeof number === "number"
						? [
								{
									phase: value.phase,
									value: number,
									...(typeof within === "string" ? { within } : {}),
								},
							]
						: [];
				}
				return [];
			} catch {
				return [];
			}
		});
	}
}

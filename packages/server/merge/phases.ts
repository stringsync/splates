import type { GatePhases } from "../records";
import type { LivePhase } from "../tasks";

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

	/** The phase each phase ran inside of, for those that ran inside one. */
	within(): NonNullable<GatePhases["within"]> {
		const within: NonNullable<GatePhases["within"]> = {};
		for (const phase of this.parsed("ms")) {
			if (phase.within) {
				within[phase.phase] = phase.within;
			}
		}
		return within;
	}

	/**
	 * The phases so far of a gate still running, in the order they started:
	 * each from the line that says it started, given its time once a line
	 * says it ended. A phase whose command marks only its end shows once it
	 * has.
	 */
	live(): LivePhase[] {
		const phases: LivePhase[] = [];
		for (const line of this.lines.split("\n")) {
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch {
				continue;
			}
			if (
				typeof value !== "object" ||
				value === null ||
				!("phase" in value) ||
				typeof value.phase !== "string"
			) {
				continue;
			}
			const { phase } = value;
			const started: unknown = Reflect.get(value, "started");
			const ms: unknown = Reflect.get(value, "ms");
			const within: unknown = Reflect.get(value, "within");
			const inside = typeof within === "string" ? { within } : {};
			if (typeof started === "string") {
				phases.push({ phase, at: started, ...inside });
			} else if (typeof ms === "number") {
				const open = phases.find(
					(each) => each.phase === phase && each.ms === undefined,
				);
				if (open === undefined) {
					phases.push({ phase, ms, ...inside });
				} else {
					open.ms = ms;
				}
			}
		}
		return phases;
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

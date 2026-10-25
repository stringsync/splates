import type { Clock } from "webappwiz/time";
import type { Facts, GatePhases } from "../records";
import type { MergeTimes } from "../tasks";

/** Updates the caller's facts even when a merge or a gate refuses. */
export class MergeTiming implements Disposable {
	private readonly started;
	constructor(
		private readonly facts: Partial<Facts["merge"]>,
		private readonly clock: Clock,
	) {
		this.started = clock.now();
		facts.durationMs = 0;
		facts.gateMs = 0;
		facts.capacityWaitMs = 0;
		facts.retests = 0;
	}

	track(fact: "gateMs" | "capacityWaitMs"): Disposable {
		const started = this.clock.now();
		return {
			[Symbol.dispose]: () => {
				this.facts[fact] =
					(this.facts[fact] ?? 0) + this.clock.now().subtract(started).ms;
			},
		};
	}

	/** Keeps a whole gate run's phases, each run's in place of the last's. */
	gated(phases: GatePhases): void {
		this.facts.gate = phases;
	}

	/** How long the merge so far waited for the premerge lock, and ran besides. */
	get times(): MergeTimes {
		const queuedMs = this.facts.capacityWaitMs ?? 0;
		return {
			queuedMs,
			ranMs: Math.max(0, this.clock.now().subtract(this.started).ms - queuedMs),
		};
	}

	[Symbol.dispose](): void {
		this.facts.durationMs = this.clock.now().subtract(this.started).ms;
	}
}

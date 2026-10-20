import type { Clock } from "webappwiz/time";
import type { Facts } from "../records";

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

	[Symbol.dispose](): void {
		this.facts.durationMs = this.clock.now().subtract(this.started).ms;
	}
}

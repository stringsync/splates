import type { Pick, ShipComposer } from "./compose";
import type { ShipEngine } from "./engine";
import { RunError } from "./run-error";
import type { Supervise } from "./run-events";
import type { RunState } from "./run-state";

/** Starts a ship of picked targets: composes them, then runs the plan. */
export class ShipStart {
	constructor(
		private readonly engine: ShipEngine,
		private readonly composer: ShipComposer,
	) {}

	/**
	 * Starts a run of `picks`, supervised when `supervise` is given, refusing
	 * one a target's command could not plan.
	 */
	async picks(
		picks: readonly Pick[],
		supervise?: Supervise,
		autoApprove?: boolean,
	): Promise<RunState> {
		const composed = await this.composer.compose(picks);
		const failed = composed.targets.filter((each) => each.error);
		if (failed.length > 0) {
			throw new RunError(
				failed.map((each) => `${each.name}: ${each.error}`).join("\n"),
				400,
			);
		}
		return this.engine.start(
			composed.targets.map(({ waves: _, error: __, ...target }) => target),
			supervise,
			autoApprove,
		);
	}
}

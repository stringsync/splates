import type { RulesEditor } from "./auto-pick-rules";
import type { MoveWatch } from "./setup-coordinator-steps";
import type { SetupJourney } from "./setup-journey";

/** A journey and what it runs, kept while the page is elsewhere. */
export interface HeldJourney {
	journey: SetupJourney;
	move: MoveWatch;
	rules: RulesEditor;
}

/**
 * The journeys begun this visit, by area, so leaving the Setup page leaves
 * a step running and coming back finds the journey at the step it was on.
 */
export class HeldJourneys {
	private readonly held = new Map<string, HeldJourney>();

	/** The journey for `area`, made by `make` when there is none yet. */
	obtain(area: string, make: () => HeldJourney): HeldJourney {
		let found = this.held.get(area);
		if (found === undefined) {
			found = make();
			this.held.set(area, found);
		}
		return found;
	}

	/** Lets `area` go, as when it is finished or undone, to begin again. */
	drop(area: string): void {
		this.held.get(area)?.move.stop();
		this.held.delete(area);
	}
}

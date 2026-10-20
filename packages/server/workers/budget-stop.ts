import type { Logger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import type { BudgetHeld, WorkerAlert, WorkerBudget } from "./budget";
import type { WorkerRecords } from "./records";
import type { HeldSlot } from "./scheduler";

/** How often the budget is looked at again as time passes, for its alerts and hard stop. */
export const BUDGET_EVERY = Duration.mins(1);

/** What the budget's look says happened, each as `WorkerProvisioning` dispatches it. */
export interface BudgetStopEvents {
	alert: (alert: WorkerAlert) => void;
	stopping: (stopped: { reason: string; held: HeldSlot[] }) => void;
	carrying: (carried: { held: BudgetHeld[] }) => void;
}

/** What `lookAtBudget` reads and stops with. */
export interface BudgetStopOptions {
	budget: WorkerBudget;
	records: WorkerRecords;
	/** Stops the made workers `ids`, answering the agents still on them. */
	stop?: (ids: string[]) => Promise<HeldSlot[]>;
	log: Logger;
}

/**
 * Alerts each tier the budget newly reached, stops the made workers once
 * the day's or month's limit is, and carries on the agents a stop held once
 * it allows again.
 */
export async function lookAtBudget(
	on: BudgetStopEvents,
	opts: BudgetStopOptions,
): Promise<void> {
	const { budget, records, stop, log } = opts;
	for (const alert of await budget.alerts()) {
		on.alert(alert);
	}
	const stopped = budget.stopped();
	const running = records.all.filter(
		(each) => each.provisioned !== null && !each.removing,
	);
	if (stopped !== null && running.length > 0 && stop !== undefined) {
		log.info(
			`${stopped}: stopping made workers ${running.map((each) => each.id).join(", ")}`,
		);
		const held = await stop(running.map((each) => each.id));
		if (held.length > 0) {
			await budget.hold(
				held.map((each) => ({
					project: each.project,
					conversation: each.id,
				})),
			);
			on.stopping({ reason: stopped, held });
		}
	}
	if (stopped === null && budget.held.length > 0) {
		const held = await budget.release();
		log.info(
			`the worker budget allows made workers again: carrying on ${held.map((each) => each.conversation).join(", ")}`,
		);
		on.carrying({ held });
	}
}

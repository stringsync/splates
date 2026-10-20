import { Dispatcher, type Eventful } from "webappwiz/events";
import { type Budgets, budgets as readBudgets } from "./api";

export type BudgetReadingEvents = { changed: undefined };

/** Where the budgets come from: `splates server`, or a test's own. */
export interface BudgetSource {
	budgets(): Promise<Budgets>;
}

/**
 * The project's scry budgets as the Budget page shows them: read each time
 * it is shown, since each read runs the CLI, and taken from what each
 * change answers.
 */
export class BudgetReading implements Eventful<BudgetReadingEvents> {
	private readonly dispatcher = new Dispatcher<BudgetReadingEvents>();
	readonly events = this.dispatcher.events;

	/** The budgets as last read or changed, null before the first reading. */
	budgets: Budgets | null = null;
	/** Why the last reading failed, or null. */
	error: string | null = null;

	constructor(
		private readonly source: BudgetSource = { budgets: readBudgets },
	) {}

	refresh(): Promise<void> {
		return this.source.budgets().then(
			(read) => this.set(read),
			(caught: Error) => {
				this.error = caught.message;
				this.dispatcher.dispatch("changed");
			},
		);
	}

	/** Takes what `change` answers; rejects as it does, for its card to say why. */
	changed(change: Promise<Budgets>): Promise<void> {
		return change.then((read) => this.set(read));
	}

	private set(budgets: Budgets): void {
		this.budgets = budgets;
		this.error = null;
		this.dispatcher.dispatch("changed");
	}
}

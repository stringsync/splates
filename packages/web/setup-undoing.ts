import type {
	SetupProgress,
	UndoCred,
	UndoPlan,
} from "@stringsync/splates-server/setup";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { setupUndoPlan, undoSetup } from "./setup-api";

/** Where undoing stands: asking, under way, failed, or done with what is left. */
export type UndoState =
	| { kind: "asking" }
	| { kind: "working" }
	| { kind: "failed"; problem: string }
	| { kind: "done" };

export type SetupUndoingEvents = {
	changed: undefined;
	/** Setup as the undo left it, for the page to show everywhere. */
	settled: SetupProgress;
};

/**
 * Undoing one area: its plan read from the server, the name typed to go
 * ahead when it asks for one, then the undo itself, which stays failed with
 * why until it is tried again.
 */
export class SetupUndoing implements Eventful<SetupUndoingEvents> {
	private readonly dispatcher = new Dispatcher<SetupUndoingEvents>();
	readonly events = this.dispatcher.events;

	/** What it would do, or null until the server answers. */
	plan: UndoPlan | null = null;
	/** Why the plan did not read, or null. */
	unread: string | null = null;
	typed = "";
	state: UndoState = { kind: "asking" };

	constructor(area: string) {
		setupUndoPlan(area).then(
			(plan) => {
				this.plan = plan;
				this.dispatcher.dispatch("changed");
			},
			(error: Error) => {
				this.unread = error.message;
				this.dispatcher.dispatch("changed");
			},
		);
	}

	/** What only the person can remove, every step's, in the plan's order. */
	get leaves(): string[] {
		return this.plan?.steps.flatMap((step) => step.leaves) ?? [];
	}

	/** The creds it forgets. */
	get forgets(): UndoCred[] {
		return this.plan?.creds.filter((cred) => cred.keptFor === null) ?? [];
	}

	/** The creds it keeps, for a step still using each. */
	get kept(): UndoCred[] {
		return this.plan?.creds.filter((cred) => cred.keptFor !== null) ?? [];
	}

	/** Whether Undo may be pressed: the plan read, not refused, and its name typed. */
	get ready(): boolean {
		const plan = this.plan;
		return (
			plan !== null &&
			plan.refused === null &&
			this.state.kind !== "working" &&
			(plan.confirm === null || this.typed.trim() === plan.confirm)
		);
	}

	type(text: string): void {
		this.typed = text;
		this.dispatcher.dispatch("changed");
	}

	/** Undoes the area, showing it under way at once and why not after. */
	async undo(): Promise<void> {
		const plan = this.plan;
		if (plan === null || !this.ready) {
			return;
		}
		this.set({ kind: "working" });
		try {
			const progress = await undoSetup(
				plan.area,
				plan.confirm === null ? null : this.typed,
			);
			this.set({ kind: "done" });
			this.dispatcher.dispatch("settled", progress);
		} catch (error) {
			this.set({
				kind: "failed",
				problem: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private set(state: UndoState): void {
		this.state = state;
		this.dispatcher.dispatch("changed");
	}
}
